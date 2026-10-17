// Stands in as "the uck loaded before observer" for the partial-view test.
export function register(_ctx) {
  return { name: "creds-like", desc: "a peer present at observer's register time", credsLike: { version: 1 }, run: () => {} };
}
export default { register };