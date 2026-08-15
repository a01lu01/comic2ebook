import test from "node:test";
import assert from "node:assert/strict";

import {
  allTerminal,
  isActive,
  mergeTask,
  overallProgress,
  statusInfo,
} from "../src/jobs-model.js";

test("mergeTask merges subtask status and progress", () => {
  const task = {
    status: "queued",
    subTasks: [{ format: "cbz", status: "pending", progress: 0 }],
  };
  mergeTask(task, {
    status: "packing",
    subTasks: [{ format: "cbz", status: "running", progress: 40 }],
  });
  assert.equal(task.status, "packing");
  assert.equal(task.subTasks[0].status, "running");
  assert.equal(task.subTasks[0].progress, 40);
});

test("overallProgress averages subtasks", () => {
  assert.equal(
    overallProgress({
      subTasks: [
        { progress: 100 },
        { progress: 50 },
        { progress: 0 },
      ],
    }),
    50
  );
});

test("statusInfo maps terminal states", () => {
  assert.equal(
    statusInfo({ status: "done", subTasks: [{ status: "done" }] }).text,
    "完成"
  );
  assert.equal(
    statusInfo({ status: "failed", subTasks: [{ status: "failed" }] }).text,
    "部分失败"
  );
  assert.equal(
    statusInfo({ status: "cancelled", subTasks: [] }).text,
    "已取消"
  );
});

test("isActive and allTerminal", () => {
  assert.equal(isActive({ status: "converting" }), true);
  assert.equal(isActive({ status: "done" }), false);
  assert.equal(
    allTerminal([{ status: "done" }, { status: "failed" }]),
    true
  );
  assert.equal(allTerminal([{ status: "done" }, { status: "packing" }]), false);
});
