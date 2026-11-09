import { describe, expect, it } from "vitest";
import { createDeskRequestScope } from "./desk-request-scope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("desk request scope", () => {
  it("ignores a delayed old sport load after the new sport loads", async () => {
    const scope = createDeskRequestScope<"mlb" | "nfl">("mlb");
    let desk = "";
    const old = deferred<string>();
    const oldToken = scope.begin("mlb")!;
    const pending = old.promise.then((value) => {
      if (scope.isCurrent(oldToken)) desk = value;
    });
    scope.select("nfl");
    const current = scope.begin("nfl")!;
    if (scope.isCurrent(current)) desk = "NFL desk";
    old.resolve("MLB desk");
    await pending;
    expect(desk).toBe("NFL desk");
    expect(scope.begin("mlb")).toBeNull();
  });

  it("ignores older refreshes and errors for the same sport", async () => {
    const scope = createDeskRequestScope<"mlb" | "nfl">("mlb");
    let error = "";
    const old = deferred<string>();
    const oldToken = scope.begin("mlb")!;
    const pending = old.promise.catch((failure: Error) => {
      if (scope.isCurrent(oldToken)) error = failure.message;
    });
    const current = scope.begin("mlb")!;
    old.reject(new Error("old fetch failed"));
    await pending;
    expect(error).toBe("");
    expect(scope.isCurrent(current)).toBe(true);
  });

  it("allows a submission to finish without changing the newly selected draft", async () => {
    const scope = createDeskRequestScope<"mlb" | "nfl">("mlb");
    const submissionToken = scope.capture();
    const accepted = deferred<string>();
    let completed = false;
    let draft = "NFL question";
    const pending = accepted.promise.then(() => {
      completed = true;
      if (scope.isSelected(submissionToken)) draft = "";
    });
    scope.select("nfl");
    accepted.resolve("queued MLB job");
    await pending;
    expect(completed).toBe(true);
    expect(draft).toBe("NFL question");
    scope.select("mlb");
    expect(scope.isSelected(submissionToken)).toBe(false);
  });

  it("invalidates pending poll responses when a newer desk refresh starts", () => {
    const scope = createDeskRequestScope<"mlb" | "nfl">("mlb");
    const pollToken = scope.capture();
    scope.begin("mlb");
    expect(scope.isCurrent(pollToken)).toBe(false);
    expect(scope.isSelected(pollToken)).toBe(true);
  });
});
