import { createHash, timingSafeEqual } from "node:crypto";

const FINISHED_PIPELINE = new Set(["success", "failed", "canceled"]);
const DELETED_SHA = /^0+$/;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

export function tokenMatches(expected, received) {
  if (!expected || typeof received !== "string") return false;
  return timingSafeEqual(digest(expected), digest(received));
}

function branchOf(ref) {
  return typeof ref === "string" ? ref.replace(/^refs\/heads\//, "") : null;
}

function pushEvent(body) {
  const sha = body?.checkout_sha || body?.after || null;
  const commit = body?.commits?.find((entry) => entry.id === sha);
  return {
    kind: "push",
    project: body?.project?.path_with_namespace ?? null,
    branch: branchOf(body?.ref),
    sha,
    author: commit?.author?.name || body?.user_name || null,
    deleted: !sha || DELETED_SHA.test(sha),
  };
}

function pipelineEvent(body) {
  const attributes = body?.object_attributes ?? {};
  return {
    kind: "pipeline",
    project: body?.project?.path_with_namespace ?? null,
    branch: attributes.tag ? null : branchOf(attributes.ref),
    sha: attributes.sha ?? null,
    author: body?.commit?.author?.name || body?.user?.name || null,
    pipelineStatus: attributes.status ?? null,
  };
}

export function classifyEvent(eventHeader, body, { project, branch, deployOn }) {
  let event;
  if (eventHeader === "Push Hook") event = pushEvent(body);
  else if (eventHeader === "Pipeline Hook") event = pipelineEvent(body);
  else return { action: "ignore", reason: "event" };

  if (event.project !== project) return { action: "ignore", reason: "project", event };
  if (event.branch !== branch) return { action: "ignore", reason: "branch", event };

  if (event.kind === "push") {
    if (event.deleted) return { action: "ignore", reason: "deleted", event };
    return { action: deployOn === "push" ? "deploy" : "record", event };
  }

  if (!FINISHED_PIPELINE.has(event.pipelineStatus)) return { action: "ignore", reason: "pipeline-running", event };
  if (deployOn === "pipeline" && event.pipelineStatus === "success") return { action: "deploy", event };
  return { action: "record", event };
}
