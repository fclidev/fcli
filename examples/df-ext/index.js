import { execSync } from "node:child_process";

// register(ctx) runs at LOAD time and gets a SUBSET of run()'s ctx: just
// { fVersion, contractVersion, self }. It does NOT get ucks/registry — there is
// no register-time view of peers to get wrong (core 0.4.0, contract v2, G11).
// The one peer accessor is ctx.registry in run(), the 3rd arg, where every uck
// is loaded. ctx.uck(name) is gone too. See CONTRACT.md N18/N19/N20.
export function register(_ctx) {
  return {
    name: "df",
    desc: "disk free (terse)",
    run: (_argv, args, _ctx) => {
      const argStr = (args._ ?? []).join(" ");
      try {
        const out = execSync(`df -h ${argStr}`, {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        if (out) process.stdout.write(out.trimEnd() + "\n");
      } catch (e) {
        if (e.stderr) process.stderr.write(e.stderr);
        process.exit(1);
      }
    },
  };
}

export default { register };
