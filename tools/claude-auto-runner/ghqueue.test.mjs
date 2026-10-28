import test from "node:test";
import assert from "node:assert/strict";
import { fetchTaskComments, PER_PAGE } from "./ghqueue.mjs";

// Giả lập gh: mỗi trang có `n` comment gốc, trong đó danh sách task đã lọc.
const fakeGh = (pages, calls = []) => (args) => {
  calls.push(args);
  const m = /&page=(\d+)/.exec(args[args.length - 1]);
  const pg = pages[Number(m[1]) - 1] || { n: 0, tasks: [] };
  return { code: 0, out: JSON.stringify(pg), err: "", error: "" };
};

test("gom task qua nhiều trang, giữ nguyên id và thứ tự (dedup do state.processed)", () => {
  const calls = [];
  const pages = [
    { n: PER_PAGE, tasks: [{ id: 1 }] },
    { n: PER_PAGE, tasks: [] },
    { n: 3, tasks: [{ id: 9 }] },
  ];
  const r = fetchTaskComments(fakeGh(pages, calls), "o/r", 53, {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.comments.map((c) => c.id), [1, 9]);
  assert.equal(calls.length, 3);
});

test("mỗi lệnh gh dùng --jq lọc và KHÔNG dùng --paginate/--slurp (không tích lũy toàn bộ issue)", () => {
  const calls = [];
  fetchTaskComments(fakeGh([{ n: 0, tasks: [] }], calls), "o/r", 53);
  const a = calls[0];
  assert.ok(a.includes("--jq"));
  assert.ok(!a.includes("--paginate") && !a.includes("--slurp"));
});

test("lỗi gh (ví dụ ENOBUFS) trả ok:false kèm thông báo, không ném", () => {
  const r = fetchTaskComments(() => ({ code: -1, out: "", err: "", error: "spawnSync gh.exe ENOBUFS" }), "o/r", 53);
  assert.equal(r.ok, false);
  assert.match(r.error, /ENOBUFS/);
});

test("giới hạn số trang tối đa", () => {
  const calls = [];
  const full = { n: PER_PAGE, tasks: [] };
  fetchTaskComments(() => { calls.push(1); return { code: 0, out: JSON.stringify(full) }; }, "o/r", 53, { maxPages: 4 });
  assert.equal(calls.length, 4);
});
