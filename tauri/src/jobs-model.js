export const STATUS_TEXT = {
  queued: "排队中",
  packing: "打包中",
  converting: "转换中",
  done: "完成",
  failed: "失败",
  cancelled: "已取消",
};

export function mergeTask(task, update) {
  if (update.status) task.status = update.status;
  if (update.error) task.error = update.error;
  if (Array.isArray(update.subTasks)) {
    for (const up of update.subTasks) {
      const sub = task.subTasks.find((s) => s.format === up.format);
      if (!sub) continue;
      if (up.status) sub.status = up.status;
      if (up.progress != null) sub.progress = up.progress;
      if (up.error) sub.error = up.error;
    }
  }
  return task;
}

export function overallProgress(task) {
  if (!task.subTasks || task.subTasks.length === 0) return 0;
  const sum = task.subTasks.reduce((acc, s) => acc + (s.progress || 0), 0);
  return Math.round(sum / task.subTasks.length);
}

export function statusInfo(task) {
  const anyFailed = (task.subTasks || []).some((s) => s.status === "failed");
  const allDone =
    (task.subTasks || []).length > 0 &&
    (task.subTasks || []).every((s) => s.status === "done");
  if (task.status === "cancelled") {
    return { cls: "cancelled", text: "已取消" };
  }
  if (allDone) {
    return { cls: "done", text: "完成" };
  }
  if (
    anyFailed &&
    !["running", "packing", "converting"].includes(task.status)
  ) {
    return { cls: "failed", text: "部分失败" };
  }
  if (["packing", "converting", "running"].includes(task.status)) {
    return { cls: "running", text: "转换中" };
  }
  return {
    cls: "pending",
    text: STATUS_TEXT[task.status] || task.status || "排队中",
  };
}

export function isActive(task) {
  return ["packing", "converting", "running"].includes(task.status);
}

export function allTerminal(tasks) {
  return (
    tasks.length > 0 &&
    tasks.every((t) => ["done", "failed", "cancelled"].includes(t.status))
  );
}
