import { execSync } from "node:child_process";

// register(ctx) runs at LOAD time and gets the SAME ctx shape as run()
// ({ fVersion, contractVersion, self, ucks, registry }) — but ucks/registry are
// a PARTIAL view of whatever has already loaded, so use them only for feature
// detection ("creds" in ctx.registry), never to conclude a peer is absent.
// The authoritative peer lookup is ctx.registry in run(), the 3rd arg, where the
// view is complete. ctx.uck(name) is gone; ctx.registry is the only accessor.
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
