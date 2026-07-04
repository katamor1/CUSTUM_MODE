const assert = require("node:assert/strict")
const { test } = require("node:test")

const oldPacket = [
  "# Bazaar Revision Review Request",
  "",
  "Review mode: singleRevision",
  "Revision target: 1",
  "",
  "## Bazaar diff"
].join("\n")

const currentPacket = [
  "# Bazaar Revision Review Request",
  "",
  "Review mode: singleRevision",
  "Revision target: 2",
  "",
  "## Bazaar diff"
].join("\n")

test("review packet selection uses the workflow state packet URI before active documents", async () => {
  const {
    REVIEW_PACKET_STATE_KEY,
    selectReviewPacketText
  } = require("../out/reviewPacketSelection")

  const selected = await selectReviewPacketText({
    activeUri: "untitled:old-packet",
    documents: [
      { uri: "untitled:old-packet", fileName: "old.md", text: oldPacket },
      { uri: "untitled:current-packet", fileName: "current.md", text: currentPacket }
    ],
    state: {
      [REVIEW_PACKET_STATE_KEY]: JSON.stringify({
        runId: "run-1",
        stepId: "review-input",
        packetUri: "untitled:current-packet"
      })
    },
    runId: "run-1"
  })

  assert.equal(selected, currentPacket)
})

test("review packet selection prompts when multiple packet candidates remain ambiguous", async () => {
  const { selectReviewPacketText } = require("../out/reviewPacketSelection")
  const offered = []

  const selected = await selectReviewPacketText({
    documents: [
      { uri: "untitled:old-packet", fileName: "old.md", text: oldPacket },
      { uri: "untitled:current-packet", fileName: "current.md", text: currentPacket }
    ],
    pickPacket: async (items) => {
      offered.push(...items.map((item) => item.uri))
      return items.find((item) => item.uri === "untitled:current-packet")
    }
  })

  assert.deepEqual(offered, ["untitled:old-packet", "untitled:current-packet"])
  assert.equal(selected, currentPacket)
})

test("review packet selection reports an explicit missing packet URI", async () => {
  const { selectReviewPacketText } = require("../out/reviewPacketSelection")

  await assert.rejects(
    () => selectReviewPacketText({
      documents: [{ uri: "untitled:old-packet", fileName: "old.md", text: oldPacket }],
      expectedUri: "untitled:missing-packet"
    }),
    /Bazaar review packet document was not found: untitled:missing-packet/
  )
})
