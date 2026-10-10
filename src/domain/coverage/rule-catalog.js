export const JURISDICTIONS = Object.freeze({
  EU: "eu",
  US: "us",
  GB: "gb",
  NI: "ni",
});

const validJurisdictions = new Set(Object.values(JURISDICTIONS));
export const EMPTY_RULE_CATALOGUE = Object.freeze([]);

const ruleStatuses = new Set(["no_issue_detected", "changes_recommended"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DISCLAIMER =
  "Advisory preflight only. This is not legal advice or a legal-compliance determination, and it does not approve export.";

function isDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function hasSourceReviewRecord(source, asOf) {
  if (
    !source ||
    typeof source.title !== "string" ||
    source.title.trim() === "" ||
    !isDate(source.verifiedAt) ||
    source.verifiedAt > asOf
  ) {
    return false;
  }

  try {
    return new URL(source.url).protocol === "https:";
  } catch {
    return false;
  }
}

function isDataRecord(value, requiredProperties = []) {
  return (
    isRecord(value) &&
    requiredProperties.every((property) => Object.hasOwn(value, property)) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) =>
      Object.hasOwn(descriptor, "value"),
    )
  );
}

function getEligibleRule(rule, { category, jurisdiction, asOf }) {
  if (
    !isDataRecord(rule, [
      "id",
      "version",
      "category",
      "jurisdiction",
      "status",
      "effectiveFrom",
      "evidenceRequirement",
      "source",
      "approval",
    ])
  ) {
    return undefined;
  }

  const {
    id,
    version,
    category: ruleCategory,
    jurisdiction: ruleJurisdiction,
    status,
    effectiveFrom,
    evidenceRequirement,
    source: sourceRecord,
    approval: approvalRecord,
  } = rule;
  const effectiveUntil = Object.hasOwn(rule, "effectiveUntil")
    ? rule.effectiveUntil
    : undefined;

  if (
    !isDataRecord(sourceRecord, ["title", "url", "verifiedAt"]) ||
    !isDataRecord(approvalRecord, ["ownerId", "approvedAt"])
  ) {
    return undefined;
  }

  const { title, url, verifiedAt } = sourceRecord;
  const { ownerId, approvedAt } = approvalRecord;
  const source = { title, url, verifiedAt };

  if (
    typeof id !== "string" ||
    id.trim() === "" ||
    typeof version !== "string" ||
    version.trim() === "" ||
    ruleCategory !== category ||
    ruleJurisdiction !== jurisdiction ||
    !validJurisdictions.has(ruleJurisdiction) ||
    status !== "approved" ||
    !isDate(effectiveFrom) ||
    effectiveFrom > asOf ||
    (effectiveUntil !== undefined &&
      (!isDate(effectiveUntil) || asOf > effectiveUntil)) ||
    typeof evidenceRequirement !== "string" ||
    evidenceRequirement.trim() === "" ||
    !hasSourceReviewRecord(source, asOf) ||
    typeof ownerId !== "string" ||
    ownerId.trim() === "" ||
    !isDate(approvedAt) ||
    approvedAt > asOf
  ) {
    return undefined;
  }

  return {
    id,
    version,
    source: { title, url },
  };
}

function evaluateRule(rule, evidence) {
  const base = {
    ruleId: rule.id,
    ruleVersion: rule.version,
    source: {
      title: rule.source.title,
      url: rule.source.url,
    },
  };
  if (
    !isRecord(evidence) ||
    !Object.hasOwn(evidence, "status") ||
    !Object.hasOwn(evidence, "locator")
  ) {
    return { ...base, status: "incomplete" };
  }

  const status = evidence.status;
  const locator = evidence.locator;
  if (
    !ruleStatuses.has(status) ||
    typeof locator !== "string" ||
    locator.trim() === ""
  ) {
    return { ...base, status: "incomplete" };
  }

  const observation = Object.hasOwn(evidence, "observation")
    ? evidence.observation
    : undefined;
  return {
    ...base,
    status,
    evidence: {
      locator,
      ...(typeof observation === "string" ? { observation } : {}),
    },
  };
}

function summarizeStatuses(statuses) {
  if (statuses.includes("changes_recommended")) {
    return "changes_recommended";
  }
  if (statuses.includes("incomplete")) {
    return "incomplete";
  }
  if (statuses.length === 0 || statuses.includes("not_evaluated")) {
    return "not_evaluated";
  }
  return "ready_for_human_review";
}

function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function evaluateAssessment({
  category,
  jurisdictions,
  catalogue = EMPTY_RULE_CATALOGUE,
  evidence = {},
  asOf = new Date().toISOString().slice(0, 10),
}) {
  if (typeof category !== "string" || category.trim() === "") {
    throw new TypeError("category must be a non-empty string");
  }
  if (!Array.isArray(jurisdictions)) {
    throw new TypeError("jurisdictions must be a non-empty array");
  }
  const jurisdictionCount = jurisdictions.length;
  if (jurisdictionCount === 0) {
    throw new TypeError("jurisdictions must be a non-empty array");
  }
  const assessmentJurisdictions = [];
  for (let index = 0; index < jurisdictionCount; index += 1) {
    if (!Object.hasOwn(jurisdictions, index)) {
      throw new TypeError("jurisdictions contains an unsupported scope identifier");
    }
    assessmentJurisdictions.push(jurisdictions[index]);
  }
  if (
    assessmentJurisdictions.some(
      (jurisdiction) => !validJurisdictions.has(jurisdiction),
    )
  ) {
    throw new TypeError("jurisdictions contains an unsupported scope identifier");
  }
  if (new Set(assessmentJurisdictions).size !== assessmentJurisdictions.length) {
    throw new TypeError("jurisdictions must not contain duplicates");
  }
  if (
    !Array.isArray(catalogue) ||
    !isRecord(evidence)
  ) {
    throw new TypeError("catalogue and evidence must be valid collections");
  }
  if (!isDate(asOf)) {
    throw new TypeError("asOf must be a valid ISO calendar date");
  }

  const results = assessmentJurisdictions.map((jurisdiction) => {
    const rules = [];
    const catalogueLength = catalogue.length;
    for (let index = 0; index < catalogueLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(catalogue, index);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        continue;
      }
      const eligibleRule = getEligibleRule(descriptor.value, {
        category,
        jurisdiction,
        asOf,
      });
      if (eligibleRule) {
        rules.push(eligibleRule);
      }
    }
    const ruleIds = new Set();
    for (const rule of rules) {
      if (ruleIds.has(rule.id)) {
        throw new TypeError(`catalogue contains duplicate eligible rule ID: ${rule.id}`);
      }
      ruleIds.add(rule.id);
    }
    const jurisdictionRecord = Object.hasOwn(evidence, jurisdiction)
      ? evidence[jurisdiction]
      : undefined;
    const jurisdictionEvidence = isRecord(jurisdictionRecord)
      ? jurisdictionRecord
      : {};
    const checks = rules.map((rule) => {
      const ruleEvidence = Object.hasOwn(jurisdictionEvidence, rule.id)
        ? jurisdictionEvidence[rule.id]
        : undefined;
      return evaluateRule(rule, ruleEvidence);
    });

    return {
      jurisdiction,
      status: summarizeStatuses(checks.map(({ status }) => status)),
      checks,
    };
  });

  return {
    advisory: true,
    disclaimer: DISCLAIMER,
    category,
    summary: summarizeStatuses(results.map(({ status }) => status)),
    jurisdictions: results,
  };
}
