import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function world() {
    const sounds = [], timers = [];
    const context = vm.createContext({
        E, DEBUG: false, heldKeys: new Set(), flash() {},
        GenArray: (n, f) => Array.from({ length: n }, (_, i) => f(i)),
        sound: new Proxy({}, { get: (_, name) => () => sounds.push(name) }),
        setTimeout: (fn, delay) => timers.push([fn, delay]),
    });
    for (const name of ["entities", "level", "game"])
        vm.runInContext(readFileSync(new URL(`../src/${name}.js`, import.meta.url), "utf8")
            .replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
    return { run: code => vm.runInContext(code, context), sounds };
}

test("every spawned unicorn has exactly one head in its original model frame", () => {
    const { run } = world();
    assert.equal(run("EArray.filter(e => e[E.KIND] === 18).length"), run("EArray.filter(e => e[E.KIND] === 2).length"));
    assert.equal(run(`EArray.filter(e => e[E.KIND] === 2).every(body => {
        const heads = EArray.filter(e => e[E.KIND] === 18 && e[E.PARENT] === body.id);
        return heads.length === 1 && heads[0].subarray(E.POS, E.POS + 3).every(n => n === 0)
            && heads[0].subarray(E.ROT, E.ROT + 3).every(n => n === 0)
            && heads[0].subarray(E.SCALE, E.SCALE + 3).every(n => n === 1)
            && heads[0].subarray(E.TILE, E.TILE + 3).every(n => n === 0)
            && heads[0][E.HEALTH] === 0 && heads[0][E.SOLID] === 0;
    })`), true);
});

test("head inherits damage and stays attached through the fatal hit and corpse expiry", () => {
    const { run } = world();
    run(`EArray.forEach(e => { if (e.id) e.fill(0); });
        spawnUnicorn(0, 0);
        const body = EArray.find(e => e[E.KIND] === 2);
        const head = EArray.find(e => e[E.KIND] === 18);
        firePellet(0, .1, -2, 0, 1);
        updateEntities(0);`);
    assert.equal(run("body[E.HEALTH]"), 3);
    assert.equal(run("head[E.DISSOLVE]"), run("body[E.DISSOLVE]"));
    assert.ok(run("head[E.DISSOLVE]") > 0);
    run("body[E.MAT_OVERRIDE] = 117; body[E.TRANSPARENCY] = .3; updateEntities(0);");
    for (const slot of [E.MAT_OVERRIDE, E.TRANSPARENCY, E.DISSOLVE_PALETTE])
        assert.equal(run(`head[${slot}]`), run(`body[${slot}]`));
    run("body[E.HEALTH] = 1; firePellet(0,.1,-2,0,1); updateEntities(0);");
    assert.equal(run("body[E.HEALTH]"), 0);
    assert.equal(run("body[E.ROT_Z]"), Math.fround(Math.PI / 2));
    assert.equal(run("head[E.PARENT]"), run("body.id"));
    assert.equal(run("head[E.ROT_Z]"), 0, "parent supplies the corpse rotation exactly once");
    run("updateEntities(4.99)");
    assert.equal(run("head[E.KIND]"), 18);
    run("updateEntities(.02)");
    assert.equal(run("body[E.KIND] + head[E.KIND]"), 0);
    run("spawn(16); updateEntities(0)");
    assert.equal(run("head[E.KIND]"), 0, "head cannot survive into a recycled parent slot");
});

test("a nearly full entity pool rolls back a partial unicorn spawn without sound", () => {
    const { run, sounds } = world();
    run("EArray.forEach(e => { e[E.KIND] = 1; e[E.SOLID] = 0; }); EArray[100].fill(0);");
    const before = sounds.length;
    assert.equal(run("spawnUnicorn(0, 0)"), undefined);
    assert.equal(run("EArray[100].every(n => n === 0)"), true);
    assert.equal(sounds.length, before);
    run("EArray[101].fill(0)");
    assert.equal(run("spawnUnicorn(0, 0)"), true);
    assert.equal(run("EArray[101][E.PARENT]"), 100);
});
