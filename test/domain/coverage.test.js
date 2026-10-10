import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_RULE_CATALOGUE,
  evaluateAssessment,
  JURISDICTIONS,
} from "../../src/domain/coverage/rule-catalog.js";

test("an empty catalogue reports each requested jurisdiction as not evaluated", () => {
  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.EU, JURISDICTIONS.US],
    catalogue: EMPTY_RULE_CATALOGUE,
    evidence: {},
  });

  assert.equal(result.advisory, true);
  assert.match(result.disclaimer, /not legal advice or a legal-compliance determination/i);
  assert.equal(result.summary, "not_evaluated");
  assert.deepEqual(
    result.jurisdictions.map(({ jurisdiction, status }) => ({
      jurisdiction,
      status,
    })),
    [
      { jurisdiction: JURISDICTIONS.EU, status: "not_evaluated" },
      { jurisdiction: JURISDICTIONS.US, status: "not_evaluated" },
    ],
  );
  assert.ok(result.jurisdictions.every(({ checks }) => checks.length === 0));
});

test("sparse jurisdiction lists are rejected instead of yielding a ready summary", () => {
  const sparse = Array(1);
  const overriddenIterator = Array(1);
  overriddenIterator[Symbol.iterator] = function* () {
    yield JURISDICTIONS.GB;
  };

  for (const jurisdictions of [sparse, overriddenIterator]) {
    assert.throws(
      () =>
        evaluateAssessment({
          category: "small-electrical-appliance",
          jurisdictions,
        }),
      /unsupported scope identifier/,
    );
  }
});

test("jurisdiction array length is read once before evaluation", () => {
  let lengthReads = 0;
  const changingLength = new Proxy([JURISDICTIONS.GB, JURISDICTIONS.NI], {
    get(target, property, receiver) {
      if (property === "length") {
        lengthReads += 1;
        return lengthReads === 1 ? 2 : 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: changingLength,
  });

  assert.equal(lengthReads, 1);
  assert.deepEqual(
    result.jurisdictions.map(({ jurisdiction }) => jurisdiction),
    [JURISDICTIONS.GB, JURISDICTIONS.NI],
  );
});

test("an approved source-backed rule only applies to its exact category and jurisdiction", () => {
  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB, JURISDICTIONS.NI],
    asOf: "2026-10-10",
    catalogue: [
      {
        id: "label-identifier",
        version: "1",
        category: "small-electrical-appliance",
        jurisdiction: JURISDICTIONS.GB,
        status: "approved",
        effectiveFrom: "2026-01-01",
        source: {
          title: "Approved rule source",
          url: "https://example.gov/rules/label-identifier",
          verifiedAt: "2026-01-01",
        },
        approval: {
          ownerId: "rules-owner-1",
          approvedAt: "2026-01-01",
        },
        evidenceRequirement: "manufacturer-identifier",
      },
    ],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": {
          status: "no_issue_detected",
          locator: "page 1, lower-right label panel",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "ready_for_human_review");
  assert.equal(result.jurisdictions[0].checks[0].status, "no_issue_detected");
  assert.equal(result.jurisdictions[0].checks[0].source.url, "https://example.gov/rules/label-identifier");
  assert.equal(result.jurisdictions[1].status, "not_evaluated");
  assert.equal(result.jurisdictions[1].checks.length, 0);
  assert.equal(result.summary, "not_evaluated");
});

test("unapproved, expired, unverified, or incomplete rules cannot produce a clean result", () => {
  const invalidRules = [
    { status: "draft" },
    { status: "approved", effectiveUntil: "2026-01-01" },
    { status: "approved", source: { verifiedAt: null } },
    {
      status: "approved",
      source: {
        title: "Future-verified source",
        url: "https://example.gov/rules",
        verifiedAt: "2027-01-01",
      },
    },
    { status: "approved", approval: null },
  ].map((overrides, index) => ({
    id: `rule-${index}`,
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
    ...overrides,
  }));

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue: invalidRules,
    evidence: {
      [JURISDICTIONS.GB]: Object.fromEntries(
        invalidRules.map(({ id }) => [
          id,
          { status: "no_issue_detected", locator: "page 1" },
        ]),
      ),
    },
  });

  assert.equal(result.jurisdictions[0].status, "not_evaluated");
  assert.deepEqual(result.jurisdictions[0].checks, []);
});

test("an inherited effectiveUntil does not expire a rule that has no own end date", () => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    Object.prototype,
    "effectiveUntil",
  );
  Object.defineProperty(Object.prototype, "effectiveUntil", {
    configurable: true,
    value: "2026-01-01",
  });

  try {
    const result = evaluateAssessment({
      category: "small-electrical-appliance",
      jurisdictions: [JURISDICTIONS.GB],
      asOf: "2026-10-10",
      catalogue: [
        {
          id: "rule-without-end-date",
          version: "1",
          category: "small-electrical-appliance",
          jurisdiction: JURISDICTIONS.GB,
          status: "approved",
          effectiveFrom: "2026-01-01",
          source: {
            title: "Rule source",
            url: "https://example.gov/rules",
            verifiedAt: "2026-01-01",
          },
          approval: {
            ownerId: "rules-owner-1",
            approvedAt: "2026-01-01",
          },
          evidenceRequirement: "manufacturer-identifier",
        },
      ],
      evidence: {
        [JURISDICTIONS.GB]: {
          "rule-without-end-date": {
            status: "no_issue_detected",
            locator: "page 1",
          },
        },
      },
    });

    assert.equal(result.jurisdictions[0].checks.length, 1);
    assert.equal(
      result.jurisdictions[0].checks[0].status,
      "no_issue_detected",
    );
  } finally {
    if (previousDescriptor) {
      Object.defineProperty(
        Object.prototype,
        "effectiveUntil",
        previousDescriptor,
      );
    } else {
      delete Object.prototype.effectiveUntil;
    }
  }
});

test("an overridden catalogue filter cannot bypass eligibility checks", () => {
  const draftRule = {
    id: "draft-rule",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "draft",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Draft source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };
  const catalogue = [draftRule];
  catalogue.filter = () => [draftRule];

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue,
    evidence: {
      [JURISDICTIONS.GB]: {
        "draft-rule": {
          status: "no_issue_detected",
          locator: "page 1",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "not_evaluated");
  assert.deepEqual(result.jurisdictions[0].checks, []);
});

test("inherited sparse catalogue entries are ignored", () => {
  const inheritedRule = {
    id: "inherited-rule",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };
  const catalogue = Array(1);
  Object.setPrototypeOf(
    catalogue,
    Object.create(Array.prototype, {
      0: { configurable: true, value: inheritedRule },
    }),
  );

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue,
    evidence: {
      [JURISDICTIONS.GB]: {
        "inherited-rule": {
          status: "no_issue_detected",
          locator: "page 1",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "not_evaluated");
  assert.deepEqual(result.jurisdictions[0].checks, []);
});

test("accessor-backed catalogue entries are ignored", () => {
  let ruleReads = 0;
  const catalogue = [];
  Object.defineProperty(catalogue, "0", {
    configurable: true,
    get() {
      ruleReads += 1;
      return {
        id: "accessor-rule",
        version: "1",
        category: "small-electrical-appliance",
        jurisdiction: JURISDICTIONS.GB,
        status: "approved",
        effectiveFrom: "2026-01-01",
        source: {
          title: "Rule source",
          url: "https://example.gov/rules",
          verifiedAt: "2026-01-01",
        },
        approval: {
          ownerId: "rules-owner-1",
          approvedAt: "2026-01-01",
        },
        evidenceRequirement: "manufacturer-identifier",
      };
    },
  });
  catalogue.length = 1;

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue,
    evidence: {},
  });

  assert.equal(ruleReads, 0);
  assert.equal(result.jurisdictions[0].status, "not_evaluated");
  assert.deepEqual(result.jurisdictions[0].checks, []);
});

test("accessor-backed rule metadata cannot change after eligibility checking", () => {
  let urlReads = 0;
  const rule = {
    id: "label-identifier",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      get url() {
        urlReads += 1;
        return urlReads === 1
          ? "https://example.gov/rules"
          : "http://attacker.example/forged";
      },
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue: [rule],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": {
          status: "no_issue_detected",
          locator: "page 1",
        },
      },
    },
  });

  assert.equal(urlReads, 0);
  assert.equal(result.jurisdictions[0].status, "not_evaluated");
  assert.deepEqual(result.jurisdictions[0].checks, []);
});

test("inherited catalogue, source, and approval fields are not eligible", () => {
  const priorSource = Object.getOwnPropertyDescriptor(Object.prototype, "source");
  const priorApproval = Object.getOwnPropertyDescriptor(Object.prototype, "approval");
  const source = {
    title: "Inherited source",
    url: "https://example.gov/rules",
    verifiedAt: "2026-01-01",
  };
  const approval = {
    ownerId: "rules-owner-1",
    approvedAt: "2026-01-01",
  };

  try {
    Object.defineProperty(Object.prototype, "source", {
      configurable: true,
      value: source,
    });
    Object.defineProperty(Object.prototype, "approval", {
      configurable: true,
      value: approval,
    });

    const result = evaluateAssessment({
      category: "small-electrical-appliance",
      jurisdictions: [JURISDICTIONS.GB],
      asOf: "2026-10-10",
      catalogue: [
        {
          id: "label-identifier",
          version: "1",
          category: "small-electrical-appliance",
          jurisdiction: JURISDICTIONS.GB,
          status: "approved",
          effectiveFrom: "2026-01-01",
          evidenceRequirement: "manufacturer-identifier",
        },
      ],
      evidence: {},
    });

    assert.equal(result.jurisdictions[0].status, "not_evaluated");
    assert.deepEqual(result.jurisdictions[0].checks, []);
  } finally {
    if (priorSource) {
      Object.defineProperty(Object.prototype, "source", priorSource);
    } else {
      delete Object.prototype.source;
    }
    if (priorApproval) {
      Object.defineProperty(Object.prototype, "approval", priorApproval);
    } else {
      delete Object.prototype.approval;
    }
  }
});

test("inherited evidence status and locator cannot produce a clean result", () => {
  const priorStatus = Object.getOwnPropertyDescriptor(Object.prototype, "status");
  const priorLocator = Object.getOwnPropertyDescriptor(Object.prototype, "locator");

  try {
    Object.defineProperty(Object.prototype, "status", {
      configurable: true,
      value: "no_issue_detected",
    });
    Object.defineProperty(Object.prototype, "locator", {
      configurable: true,
      value: "page 1",
    });

    const result = evaluateAssessment({
      category: "small-electrical-appliance",
      jurisdictions: [JURISDICTIONS.GB],
      asOf: "2026-10-10",
      catalogue: [
        {
          id: "label-identifier",
          version: "1",
          category: "small-electrical-appliance",
          jurisdiction: JURISDICTIONS.GB,
          status: "approved",
          effectiveFrom: "2026-01-01",
          source: {
            title: "Rule source",
            url: "https://example.gov/rules",
            verifiedAt: "2026-01-01",
          },
          approval: {
            ownerId: "rules-owner-1",
            approvedAt: "2026-01-01",
          },
          evidenceRequirement: "manufacturer-identifier",
        },
      ],
      evidence: {
        [JURISDICTIONS.GB]: {
          "label-identifier": {},
        },
      },
    });

    assert.equal(result.jurisdictions[0].status, "incomplete");
    assert.equal(result.jurisdictions[0].checks[0].status, "incomplete");
  } finally {
    if (priorStatus) {
      Object.defineProperty(Object.prototype, "status", priorStatus);
    } else {
      delete Object.prototype.status;
    }
    if (priorLocator) {
      Object.defineProperty(Object.prototype, "locator", priorLocator);
    } else {
      delete Object.prototype.locator;
    }
  }
});

test("missing or uncertain evidence is incomplete, never a clean result", () => {
  const rule = {
    id: "label-identifier",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue: [rule],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": { status: "uncertain" },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "incomplete");
  assert.equal(result.jurisdictions[0].checks[0].status, "incomplete");
  assert.equal(result.summary, "incomplete");
});

test("accessor-backed evidence status is read once and the validated value is reported", () => {
  const rule = {
    id: "label-identifier",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };
  let statusReads = 0;
  const evidence = {
    [JURISDICTIONS.GB]: {
      "label-identifier": {
        get status() {
          statusReads += 1;
          return statusReads === 1 ? "no_issue_detected" : "unexpected";
        },
        locator: "page 1",
      },
    },
  };

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue: [rule],
    evidence,
  });

  assert.equal(statusReads, 1);
  assert.equal(result.jurisdictions[0].checks[0].status, "no_issue_detected");
  assert.equal(result.jurisdictions[0].status, "ready_for_human_review");
});

test("evidence for one UK jurisdiction cannot clear a check in the other", () => {
  const makeRule = (jurisdiction, evidenceRequirement) => ({
    id: "label-identifier",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement,
  });

  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB, JURISDICTIONS.NI],
    asOf: "2026-10-10",
    catalogue: [
      makeRule(JURISDICTIONS.GB, "manufacturer-identifier"),
      makeRule(JURISDICTIONS.NI, "responsible-person-address"),
    ],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": {
          status: "no_issue_detected",
          locator: "page 1, lower-right label panel",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "ready_for_human_review");
  assert.equal(result.jurisdictions[1].status, "incomplete");
  assert.equal(result.summary, "incomplete");
});

test("malformed or inherited jurisdiction evidence cannot clear an eligible rule", () => {
  const rule = {
    id: "0",
    version: "1",
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement: "manufacturer-identifier",
  };
  const cleanEvidence = {
    status: "no_issue_detected",
    locator: "page 1",
  };
  const inheritedJurisdiction = Object.create({
    [JURISDICTIONS.GB]: { "0": cleanEvidence },
  });
  const inheritedRuleEvidence = {
    [JURISDICTIONS.GB]: Object.create({ "0": cleanEvidence }),
  };
  class EvidenceMap {
    constructor(value) {
      Object.assign(this, value);
    }
  }

  for (const evidence of [
    { [JURISDICTIONS.GB]: [cleanEvidence] },
    inheritedRuleEvidence,
    {
      [JURISDICTIONS.GB]: new EvidenceMap({ "0": cleanEvidence }),
    },
    {
      [JURISDICTIONS.GB]: {
        "0": new EvidenceMap(cleanEvidence),
      },
    },
  ]) {
    const result = evaluateAssessment({
      category: "small-electrical-appliance",
      jurisdictions: [JURISDICTIONS.GB],
      asOf: "2026-10-10",
      catalogue: [rule],
      evidence,
    });

    assert.equal(result.jurisdictions[0].status, "incomplete");
    assert.equal(result.jurisdictions[0].checks[0].status, "incomplete");
  }

  for (const evidence of [
    inheritedJurisdiction,
    new EvidenceMap({
      [JURISDICTIONS.GB]: {
        "0": cleanEvidence,
      },
    }),
  ]) {
    assert.throws(
      () =>
        evaluateAssessment({
          category: "small-electrical-appliance",
          jurisdictions: [JURISDICTIONS.GB],
          asOf: "2026-10-10",
          catalogue: [rule],
          evidence,
        }),
      /catalogue and evidence must be valid collections/,
    );
  }
});

test("aggregate status surfaces findings even when another jurisdiction is unevaluated", () => {
  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB, JURISDICTIONS.NI],
    asOf: "2026-10-10",
    catalogue: [
      {
        id: "label-identifier",
        version: "1",
        category: "small-electrical-appliance",
        jurisdiction: JURISDICTIONS.GB,
        status: "approved",
        effectiveFrom: "2026-01-01",
        source: {
          title: "Rule source",
          url: "https://example.gov/rules",
          verifiedAt: "2026-01-01",
        },
        approval: {
          ownerId: "rules-owner-1",
          approvedAt: "2026-01-01",
        },
        evidenceRequirement: "manufacturer-identifier",
      },
    ],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": {
          status: "changes_recommended",
          locator: "page 1",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "changes_recommended");
  assert.equal(result.jurisdictions[1].status, "not_evaluated");
  assert.equal(result.summary, "changes_recommended");
});

test("overlapping versions with the same rule ID cannot reuse one evidence record", () => {
  const makeRule = (version, evidenceRequirement) => ({
    id: "label-identifier",
    version,
    category: "small-electrical-appliance",
    jurisdiction: JURISDICTIONS.GB,
    status: "approved",
    effectiveFrom: "2026-01-01",
    source: {
      title: "Rule source",
      url: "https://example.gov/rules",
      verifiedAt: "2026-01-01",
    },
    approval: {
      ownerId: "rules-owner-1",
      approvedAt: "2026-01-01",
    },
    evidenceRequirement,
  });

  assert.throws(
    () =>
      evaluateAssessment({
        category: "small-electrical-appliance",
        jurisdictions: [JURISDICTIONS.GB],
        asOf: "2026-10-10",
        catalogue: [
          makeRule("1", "manufacturer-identifier"),
          makeRule("2", "responsible-person-address"),
        ],
        evidence: {
          [JURISDICTIONS.GB]: {
            "label-identifier": {
              status: "no_issue_detected",
              locator: "page 1",
            },
          },
        },
      }),
    /duplicate eligible rule ID/,
  );
});

test("GB and NI are separate scopes, and a finding never becomes a human decision", () => {
  const result = evaluateAssessment({
    category: "small-electrical-appliance",
    jurisdictions: [JURISDICTIONS.GB],
    asOf: "2026-10-10",
    catalogue: [
      {
        id: "label-identifier",
        version: "1",
        category: "small-electrical-appliance",
        jurisdiction: JURISDICTIONS.GB,
        status: "approved",
        effectiveFrom: "2026-01-01",
        source: {
          title: "Rule source",
          url: "https://example.gov/rules",
          verifiedAt: "2026-01-01",
        },
        approval: {
          ownerId: "rules-owner-1",
          approvedAt: "2026-01-01",
        },
        evidenceRequirement: "manufacturer-identifier",
      },
    ],
    evidence: {
      [JURISDICTIONS.GB]: {
        "label-identifier": {
          status: "changes_recommended",
          locator: "page 1, lower-right label panel",
          observation: "identifier not found",
        },
      },
    },
  });

  assert.equal(result.jurisdictions[0].status, "changes_recommended");
  assert.equal(result.jurisdictions[0].checks[0].status, "changes_recommended");
  assert.equal("humanDecision" in result, false);
  assert.equal(result.advisory, true);
});
