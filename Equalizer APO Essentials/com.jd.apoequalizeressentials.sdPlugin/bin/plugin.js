import streamDeck from "@elgato/streamdeck";
import { readFileSync, writeFileSync, watchFile } from "node:fs";
import { basename } from "node:path";

const DEFAULT_CONFIG = "C:\\Program Files\\EqualizerAPO\\config\\config.txt";
const VST_LINE = /^(\s*)(#*)\s*VSTPlugin:\s*Library\s*"([^"]+)"/i;
const watched = new Set();

function scan(path) {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const seen = new Map();
    const plugins = [];

    lines.forEach((line, index) => {
        const match = VST_LINE.exec(line);
        if (!match) return;
        const key = match[3].toLowerCase();
        const nth = (seen.get(key) ?? 0) + 1;
        seen.set(key, nth);
        plugins.push({
            id: `${key}#${nth}`,
            name: basename(match[3], ".dll") + (nth > 1 ? ` #${nth}` : ""),
            enabled: match[2] === "",
            index
        });
    });

    return { lines, plugins };
}

function follow(path) {
    if (watched.has(path)) return;
    watched.add(path);
    watchFile(path, { interval: 1000 }, async () => {
        for (const action of streamDeck.actions) render(action, await action.getSettings());
    });
}

async function render(action, settings) {
    const path = settings.config || DEFAULT_CONFIG;
    let plugin;

    try {
        follow(path);
        plugin = scan(path).plugins.find((candidate) => candidate.id === settings.id);
    } catch (error) {
        streamDeck.logger.error(error);
    }

    await action.setTitle(plugin ? plugin.name.replace(/[ _-]+/g, "\n") : "?");
    await action.setState(plugin?.enabled ? 1 : 0);
}

streamDeck.actions.onWillAppear((ev) => render(ev.action, ev.payload.settings));
streamDeck.settings.onDidReceiveSettings((ev) => render(ev.action, ev.payload.settings));

streamDeck.actions.onKeyDown(async (ev) => {
    const settings = await ev.action.getSettings();
    const path = settings.config || DEFAULT_CONFIG;

    try {
        const { lines, plugins } = scan(path);
        const plugin = plugins.find((candidate) => candidate.id === settings.id);
        if (!plugin) throw new Error(`VST not found in ${path}: ${settings.id}`);

        lines[plugin.index] = plugin.enabled
            ? `#${lines[plugin.index]}`
            : lines[plugin.index].replace(/^(\s*)#+ ?/, "$1");
        writeFileSync(path, lines.join("\r\n"), "utf8");

        await ev.action.setState(plugin.enabled ? 0 : 1);
    } catch (error) {
        streamDeck.logger.error(error);
        await ev.action.showAlert();
    }
});

streamDeck.ui.onSendToPlugin(async (ev) => {
    const path = ev.payload?.config || (await ev.action.getSettings()).config || DEFAULT_CONFIG;

    try {
        follow(path);
        await streamDeck.ui.sendToPropertyInspector({
            config: path,
            plugins: scan(path).plugins.map(({ id, name, enabled }) => ({ id, name, enabled }))
        });
    } catch (error) {
        streamDeck.logger.error(error);
        await streamDeck.ui.sendToPropertyInspector({ config: path, plugins: [], error: String(error.message) });
    }
});

streamDeck.connect();
