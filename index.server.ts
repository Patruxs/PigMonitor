import type { PluginServerContext } from "@getpaseo/plugin/server";
import { piggeryPath } from "./server/installed.ts";
import { MailReader, pickDatabase } from "./server/mail.ts";
import { pickBin, realDir, runPiggery } from "./server/piggery.ts";
import { Person } from "./server/person.ts";
import { configureAgent, resumeInPaseo, stopAgent } from "./server/paseo.ts";
import { ATTACH_ROOT, bodyWithImages, saveImages } from "./server/attach.ts";
import { TranscriptReader } from "./server/transcript.ts";
import { pastedImageSaver, readImage } from "./server/image.ts";
import { agentConfig, imageFile, mail, person, resume, sendMail, sessions, settings, snapshot, stop, tail, transcript, viewSettings } from "./shared/rpc.ts";
import { TAIL_VERSION } from "./shared/view.ts";

export default function contribute(server: PluginServerContext) {
  const stored = server.registerSettings(settings);
  server.registerSettings(viewSettings);
  const bin = async () => {
    const state = await stored.read();
    return pickBin(state.status === "ready" ? state.values.path : "", piggeryPath);
  };

  server.handle(snapshot, async ({ dir }) => {
    const b = await bin();
    const r = await runPiggery(b, ["ps", "--view"]);
    if (!r.ok) return r;
    try {
      const view = JSON.parse(r.out) as Record<string, unknown>;
      return { ok: true as const, view, dir: dir === undefined ? undefined : await realDir(dir) };
    } catch {
      return { ok: false as const, code: "failed" as const, error: "piggery ps --view did not print JSON." };
    }
  });

  server.handle(tail, async ({ id, lines }) => {
    const r = await runPiggery(await bin(), ["tail", id, "-n", String(lines), "--view"]);
    if (!r.ok) return r;
    try {
      const doc = JSON.parse(r.out);
      if (doc.version < TAIL_VERSION) return { ok: false as const, code: "older" as const, error: `piggery speaks tail --view version ${doc.version}; this plugin reads ${TAIL_VERSION}. Update piggery.` };
      if (doc.version > TAIL_VERSION) return { ok: false as const, code: "newer" as const, error: `piggery speaks tail --view version ${doc.version}; this plugin reads ${TAIL_VERSION}. Run piggery setup paseo to update the plugin, then reload the Paseo app.` };
      if (Array.isArray(doc.lines)) return { ok: true as const, lines: doc.lines };
    } catch {}
    return { ok: false as const, code: "failed" as const, error: "piggery tail --view did not print JSON." };
  });

  const reader = new MailReader();
  server.handle(mail, async (filter) => {
    const state = await stored.read();
    return reader.read(pickDatabase(state.status === "ready" ? state.values.database : ""), filter);
  });

  const transcripts = new TranscriptReader(reader, pastedImageSaver(`${ATTACH_ROOT}/pasted`));
  server.handle(transcript, async ({ id, before, limit }) => {
    const state = await stored.read();
    return transcripts.read(pickDatabase(state.status === "ready" ? state.values.database : ""), id, before, limit);
  });

  server.handle(imageFile, async ({ path }) => readImage(path));

  const me = new Person((line) => console.log(line));
  const database = async () => {
    const state = await stored.read();
    return pickDatabase(state.status === "ready" ? state.values.database : "");
  };
  void database().then((db) => me.warm(db));
  server.handle(person, async () => {
    const who = me.current(await database());
    return { ok: true as const, person: who ? { id: who.id, name: who.name } : null };
  });
  server.handle(sendMail, async ({ images, ...input }) => {
    let files: string[];
    try {
      files = await saveImages(ATTACH_ROOT, input.to, images ?? []);
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: `Could not save the image: ${String((error as Error).message ?? error)}` };
    }
    const body = bodyWithImages(input.body, files);
    if (!body) return { ok: false as const, code: "failed" as const, error: "Nothing to send." };
    return me.send(await database(), { ...input, body });
  });
  server.handle(sessions, async ({ ids }) => {
    try {
      return { ok: true as const, sessions: reader.sessions(await database(), ids) };
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: `Could not read piggery's database: ${String((error as Error).message ?? error)}` };
    }
  });
  server.handle(agentConfig, async ({ agentId, field, value }) => configureAgent(agentId, field, value));
  server.handle(stop, async ({ id, agentId }) => {
    if (agentId) return stopAgent(agentId);
    const r = await runPiggery(await bin(), ["abort", id]);
    return r.ok ? { ok: true as const } : r;
  });
  server.handle(resume, async ({ id }) => {
    try {
      return await resumeInPaseo(reader.sessions(await database(), [id])[0]);
    } catch (error) {
      return { ok: false as const, code: "failed" as const, error: String((error as Error).message ?? error) };
    }
  });

  return () => {
    me.stop();
    reader.close();
  };
}
