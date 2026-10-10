# Artwork Validator

This repository currently contains a **domain-only, non-production foundation**
for artwork preflight coverage and result classification. It is not an upload or
artwork-analysis product.

The rule catalogue is intentionally empty. With no owner-approved rules, every
requested jurisdiction is reported as `not_evaluated`; no regulatory checks are
enabled. Great Britain and Northern Ireland are separate jurisdiction values.
Any reported result is advisory and is not legal advice, a legal-compliance
determination, or export approval. Evidence is scoped to a jurisdiction and
rule ID; missing, malformed, or inherited evidence entries are treated as
incomplete. Invalid top-level assessment arguments are rejected.
Aggregate summaries retain observed findings even when another jurisdiction
has no evaluated checks.

## Current boundary

- Implemented: conservative selection of explicitly approved, in-date rule
  records and classification of supplied evidence as a finding, no issue
  detected, incomplete, or not evaluated. Overlapping eligible rules with a
  duplicate ID are rejected so one evidence record cannot satisfy two rule
  versions.
- Not implemented: a web interface, identity or organization authorization,
  artwork uploads/storage, retention or deletion, document parsing, isolated
  workers, human decisions, or assessment persistence/history.
- Not validated: any EU, US, or UK rule catalogue, or parser/version fidelity
  for PDF, Illustrator, EPS, or SVG. Do not advertise checks for these formats
  or treat the synthetic records in unit tests as regulatory approval.

`evaluateAssessment` is a domain helper, not an authorization boundary. A
future application must load its catalogue only from a trusted, qualified-owner
approval process and must not accept rule or evidence records directly from
users. The helper's source and approval fields validate record shape and dates;
they do not establish that a source is legally applicable or that an approver is
qualified.

Before enabling checks or accepting artwork, the product still needs the
qualified category-by-jurisdiction coverage matrix and primary-source
validation; representative format fixtures and parser/version fidelity
evidence; an approved retention/deletion policy; and an application,
authentication, and authorization design.

## Development

Requires Node.js with the built-in test runner:

```sh
npm test
```
