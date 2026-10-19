// A second uck with a versioned peer surface. Historically this fixture stood
// in as "the uck loaded before observer" to prove the register-time partial
// view saw earlier peers; G11 deleted that view, so it is now just another uck
// a run()-time registry lookup can find.
export function register(_ctx) {
  return { name: "creds-like", desc: "a peer with a versioned surface", credsLike: { version: 1 }, run: () => {} };
}
export default { register };
