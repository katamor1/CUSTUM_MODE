# Built-in mode reproduction notes

This package recreates the built-in Bob modes as same-slug custom modes:

- `plan`
- `ask`
- `code`
- `advanced`
- `orchestrator`

The main `.bob/custom_modes.yaml` keeps the mode definitions compact and places detailed behavior in `.bob/rules-<slug>/01-core.md`.

For a closer one-file reproduction of the extracted bundle definitions, see `.bob/custom_modes.exact.yaml`.

## Caution
Custom modes with the same slug override built-in modes. Back up existing `.bob/custom_modes.yaml` and rules folders before copying this package into a project.
