---
name: Issue
description: Report a bug, request a feature, or suggest a chore using the standard template.
title: ''
labels: []
assignees: []
body:
  - type: markdown
    id: context
    attributes:
      label: Context
      description: What's the background or motivation for this work?
      placeholder: |
        e.g. "The repo has X but no Y", "We need to support Z because…"
    validations:
      required: true

  - type: markdown
    id: scope
    attributes:
      label: Scope
      description: "What needs to change? Use a checklist: - [ ] …"
      placeholder: |
        - [ ] …
        - [ ] …
    validations:
      required: true

  - type: markdown
    id: acceptance
    attributes:
      label: Acceptance criteria
      description: When is this done? How do we verify success?
      placeholder: |
        - CI green on main; a size regression fails the PR
    validations:
      required: true

  - type: markdown
    id: dependencies
    attributes:
      label: Dependencies
      description: Any blocking or dependent issues? Anything that needs to ship first?
      placeholder: |
        None.
    validations:
      required: false
