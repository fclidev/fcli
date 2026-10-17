// Captures the EXACT ctx object core hands to register(), by reference.
//
// A fixture cannot assert "core did not give me ctx.uck" — the fixture writes
// its own assertions about its own object, so such a test passes even when the
// loader grows the field back. So this fixture just keeps the object, and
// ctx-contract.test.js asserts against the real object core constructed.
export function register(ctx) {
  return {
    name: "observer",
    desc: "captures the register-time ctx object for the test to inspect",
    ctx,
    run: () => {},
  };
}
export default { register };
