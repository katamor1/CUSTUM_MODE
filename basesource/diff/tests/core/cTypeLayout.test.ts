import { describe, expect, it } from "vitest";
import { parseCProject } from "../../src/core/cProjectParser";
import {
  createCTypeLayoutResolver,
  UNRESOLVED_LAYOUT
} from "../../src/core/cTypeLayout";

describe("createCTypeLayoutResolver", () => {
  it("resolves MSVC 32-bit built-ins, pointers, enums, typedefs, and macro array dimensions", async () => {
    const project = await parseCProject([
      {
        relativePath: "include/types.h",
        content: `
#define BASE 2
#define COLS (BASE + 1)
typedef unsigned short WORD;
enum Mode { MODE_A, MODE_B };
extern WORD table[2][COLS];
extern int *pointer_value;
extern enum Mode mode;
extern long double wide_value;
`
      }
    ]);
    const resolver = createCTypeLayoutResolver(project);
    const variables = new Map(project.files[0].globalVariables.map((variable) => [variable.name, variable]));

    expect(resolver.layoutVariable(variables.get("table")!)).toEqual(expect.objectContaining({
      sizeBytes: 12,
      alignmentBytes: 2,
      arrayDimensions: [2, 3],
      elementCount: 6
    }));
    expect(resolver.layoutVariable(variables.get("pointer_value")!)).toEqual(expect.objectContaining({
      sizeBytes: 4,
      alignmentBytes: 4,
      arrayDimensions: [],
      elementCount: 1
    }));
    expect(resolver.layoutVariable(variables.get("mode")!).sizeBytes).toBe(4);
    expect(resolver.layoutVariable(variables.get("wide_value")!).sizeBytes).toBe(8);
  });

  it("calculates struct padding, union size, and member offsets", async () => {
    const project = await parseCProject([
      {
        relativePath: "include/layout.h",
        content: `
struct Sample {
  char tag;
  int value;
  short code;
};
union Value {
  char bytes[5];
  double number;
};
extern struct Sample sample_value;
`
      }
    ]);
    const resolver = createCTypeLayoutResolver(project);
    const sample = project.files[0].records.find((record) => record.name === "Sample")!;
    const value = project.files[0].records.find((record) => record.name === "Value")!;
    const sampleVariable = project.files[0].globalVariables.find(
      (variable) => variable.name === "sample_value"
    )!;

    expect(resolver.layoutRecord(sample)).toEqual(expect.objectContaining({
      sizeBytes: 12,
      alignmentBytes: 4,
      members: [
        expect.objectContaining({ name: "tag", offsetBytes: 0, sizeBytes: 1 }),
        expect.objectContaining({ name: "value", offsetBytes: 4, sizeBytes: 4 }),
        expect.objectContaining({ name: "code", offsetBytes: 8, sizeBytes: 2 })
      ]
    }));
    expect(resolver.layoutRecord(value)).toEqual(expect.objectContaining({
      sizeBytes: 8,
      alignmentBytes: 8,
      members: [
        expect.objectContaining({ name: "bytes", offsetBytes: 0, sizeBytes: 5 }),
        expect.objectContaining({ name: "number", offsetBytes: 0, sizeBytes: 8 })
      ]
    }));
    expect(resolver.layoutVariable(sampleVariable).sizeBytes).toBe(12);
  });

  it("resolves standard fixed-width and pointer-sized integer typedefs without parsing system headers", async () => {
    const project = await parseCProject([{
      relativePath: "include/wire.h",
      content: `
#pragma pack(push, 1)
struct Wire {
  uint8_t byte_value;
  uint16_t short_value;
  uint32_t long_value;
  uint64_t wide_value;
  size_t length;
  intptr_t address;
};
#pragma pack(pop)
`
    }]);
    const resolver = createCTypeLayoutResolver(project);

    expect(resolver.layoutRecord(project.files[0].records[0])).toEqual(expect.objectContaining({
      sizeBytes: 23,
      alignmentBytes: 1
    }));
  });

  it("applies pragma pack push, pop, set, and reset in file order", async () => {
    const project = await parseCProject([
      {
        relativePath: "include/packed.h",
        content: `
#pragma pack(push, 1)
struct Packed { char tag; int value; };
#pragma pack(pop)
struct Normal { char tag; int value; };
#pragma pack(2)
struct PackedTwo { char tag; int value; };
#pragma pack()
struct Reset { char tag; int value; };
`
      }
    ]);
    const resolver = createCTypeLayoutResolver(project);
    const records = new Map(project.files[0].records.map((record) => [record.name, record]));

    expect(resolver.layoutRecord(records.get("Packed")!).sizeBytes).toBe(5);
    expect(resolver.layoutRecord(records.get("Packed")!).alignmentBytes).toBe(1);
    expect(resolver.layoutRecord(records.get("Normal")!).sizeBytes).toBe(8);
    expect(resolver.layoutRecord(records.get("PackedTwo")!).sizeBytes).toBe(6);
    expect(resolver.layoutRecord(records.get("PackedTwo")!).alignmentBytes).toBe(2);
    expect(resolver.layoutRecord(records.get("Reset")!).sizeBytes).toBe(8);
  });

  it("supports self-referential pointers without treating them as value cycles", async () => {
    const project = await parseCProject([
      {
        relativePath: "include/node.h",
        content: `
struct Node {
  int value;
  struct Node *next;
};
`
      }
    ]);
    const resolver = createCTypeLayoutResolver(project);

    expect(resolver.layoutRecord(project.files[0].records[0])).toEqual(expect.objectContaining({
      sizeBytes: 8,
      alignmentBytes: 4
    }));
  });

  it("marks unresolved external types, value cycles, VLA, flexible arrays, and bitfields as unresolved", async () => {
    const project = await parseCProject([
      {
        relativePath: "include/unresolved.h",
        content: `
extern ExternalType external_value;
extern int variable_length[unknown_count];
struct Recursive { struct Recursive value; };
struct Flexible { int count; char data[]; };
struct Bits { unsigned value : 3; };
`
      }
    ]);
    const resolver = createCTypeLayoutResolver(project);
    const variables = new Map(project.files[0].globalVariables.map((variable) => [variable.name, variable]));
    const records = new Map(project.files[0].records.map((record) => [record.name, record]));

    expect(resolver.layoutVariable(variables.get("external_value")!).sizeBytes).toBe(UNRESOLVED_LAYOUT);
    expect(resolver.layoutVariable(variables.get("variable_length")!)).toEqual(expect.objectContaining({
      sizeBytes: UNRESOLVED_LAYOUT,
      arrayDimensions: [UNRESOLVED_LAYOUT],
      elementCount: UNRESOLVED_LAYOUT
    }));
    expect(resolver.layoutRecord(records.get("Recursive")!).sizeBytes).toBe(UNRESOLVED_LAYOUT);
    expect(resolver.layoutRecord(records.get("Flexible")!).sizeBytes).toBe(UNRESOLVED_LAYOUT);
    expect(resolver.layoutRecord(records.get("Bits")!).sizeBytes).toBe(UNRESOLVED_LAYOUT);
    expect(resolver.layoutMember(
      records.get("Bits")!.members[0],
      records.get("Bits")!
    ).sizeBytes).toBe(UNRESOLVED_LAYOUT);
  });
});
