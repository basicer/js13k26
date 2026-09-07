import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function level() {
    const context = vm.createContext({ E, GenArray: (n, f) => Array.from({ length: n }, (_, i) => f(i)) });
    for (const file of ["entities", "level"])
        vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
            .replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
    const run = code => vm.runInContext(code, context);
    run("setupEntities(); setupLevel(() => {}); const doors = EArray.filter(e => e[E.KIND] === 19);");
    return run;
}

test("four section entrances have positioned roots and zero-position door panels", () => {
    const run = level();
    assert.equal(run("doors.length"), 4);
    for (const [i, x, z, width, depth] of [[0,-6,-12,1,4],[1,2,6,4,1],[2,-14,20,1,4],[3,-37.5,12.5,4,1]]) {
        const door = run(`doors[${i}]`), root = run(`EArray[doors[${i}][E.PARENT]]`);
        assert.equal(root[E.KIND], 1);
        assert.equal(root[E.PARENT], run(`sections[${[1,2,2,4][i]}].id`));
        assert.deepEqual(Array.from(door.subarray(E.POS, E.POS + 3)), [0, 0, 0]);
        assert.deepEqual(Array.from(root.subarray(E.SCALE, E.SCALE + 3)), [1, 1, 1]);
        assert.equal(root[E.POS_X], x);
        assert.equal(root[E.POS_Z], z);
        assert.equal(door[E.SCALE_X], width);
        assert.equal(door[E.SCALE_Z], depth);
        assert.equal(door[E.SOLID], 1);
        assert.deepEqual(Array.from(door.subarray(E.TILE, E.TILE + 3)), [-2, -2, -2]);
        assert.equal(root[E.SOLID], 0);
        assert.ok(Math.abs(root[E.POS_Y] - door[E.SCALE_Y] / 2 + 30 / 64) < 1e-6);
    }
});

test("closed doors block entrances and shots; moving panels upward clears both", () => {
    const run = level();
    for (let i = 0; i < 4; i++) {
        run(`globalThis.panel = doors[${i}]; globalThis.root = EArray[panel[E.PARENT]];
            globalThis.x = root[E.POS_X]; globalThis.z = root[E.POS_Z];
            globalThis.dx = panel[E.SCALE_X] === 1 ? 1.5 : 0;
            globalThis.dz = dx ? 0 : 1.5;`);
        assert.equal(run("canStand(x, z)"), false);
        assert.ok(run("shotFraction(x-dx,z-dz,x+dx,z+dz,.8)") < 1);
        run("panel[E.POS_Y] = 3");
        assert.equal(run("canStand(x, z)"), true);
        assert.equal(run("shotFraction(x-dx,z-dz,x+dx,z+dz,.8)"), 1);
        run("panel[E.POS_Y] = 0");
        assert.equal(run("canStand(x, z)"), false);
    }
});

test("door collision follows root and local panel translation but ignores visual section height", () => {
    const run = level();
    run(`const panel = doors[0], root = EArray[panel[E.PARENT]];
        EArray.forEach(e => { if (e !== panel) e[E.SOLID] = 0; });
        root[E.POS_X] = 10; root[E.POS_Z] = 12;
        panel[E.POS_X] = 2; panel[E.POS_Z] = -1;
        sections[1][E.POS_Y] = 8;`);
    assert.equal(run("canStand(-6, -12)"), true);
    assert.equal(run("canStand(10, 12)"), true);
    assert.equal(run("canStand(12, 11)"), false);
    assert.ok(run("shotFraction(10,11,14,11,.8)") < 1);
    assert.equal(run("shotFraction(10,11,14,11,8.8)"), 1);
    run("panel[E.POS_Y] = 3");
    assert.equal(run("canStand(12, 11)"), true);
});

test("each console targets its preceding door panel and opens/closes it in the same frame", () => {
    const run = level();
    const consoles = run("EArray.filter(e => e[E.KIND] === 15)");
    assert.equal(consoles.length, 4);
    for (const console of consoles) {
        const door = run(`EArray[${console[E.CONTROLLER]}]`);
        assert.equal(console[E.CONTROLLER], console.id - 1);
        assert.equal(door[E.KIND], 19);
        assert.equal(run(`EArray[${door[E.PARENT]}][E.PARENT]`), console[E.PARENT]);
        console[E.MODEL_VARIANT] = 1;
    }
    run("updateEntities(.5)");
    for (const [i, door] of run("doors").entries()) {
        const axis = [2, 0, 2, 0][i];
        const destination = [0, 0, 0];
        destination[axis] = 4;
        assert.deepEqual(Array.from(door.subarray(E.TARGET_POSITION, E.TARGET_POSITION + 3)), destination);
        assert.equal(door[E.LERP_SPEED], 2);
        assert.ok(Math.abs(door[E.POS + axis] - 4 * (1 - Math.exp(-1))) < 1e-6);
        assert.equal(door[E.POS + 2 - axis], 0);
        assert.equal(door[E.POS_Y], 0);
    }
    run("updateEntities(5)");
    for (const door of run("doors"))
        assert.equal(run(`canStand(EArray[${door[E.PARENT]}][E.POS_X], EArray[${door[E.PARENT]}][E.POS_Z])`), true);
    for (const console of consoles) console[E.MODEL_VARIANT] = 0;
    run("updateEntities(5)");
    for (const door of run("doors")) {
        assert.deepEqual(Array.from(door.subarray(E.TARGET_POSITION, E.TARGET_POSITION + 3)), [0, 0, 0]);
        assert.ok(door[E.POS_Z] < .001);
        assert.ok(door[E.POS_X] < .001);
        assert.equal(run(`canStand(EArray[${door[E.PARENT]}][E.POS_X], EArray[${door[E.PARENT]}][E.POS_Z])`), false);
    }
});

test("target movement respects elapsed time, pause, zero speed, velocity, and slot reuse", () => {
    const run = level();
    run("setupEntities(); const a = spawn(1); a.set([2,4,6], E.TARGET_POSITION); a[E.LERP_SPEED] = 2; updateEntities(0)");
    assert.equal(run("a[E.POS_Z]"), 0);
    run("updateEntities(1)");
    const expected = Array.from(run("a.subarray(E.POS,E.POS+3)"));
    run("a.fill(0,E.POS,E.POS+3); for(let i=0;i<60;i++) updateEntities(1/60)");
    Array.from(run("a.subarray(E.POS,E.POS+3)")).forEach((v,i) => assert.ok(Math.abs(v-expected[i]) < 2e-6));
    run("updateEntities(100)");
    assert.deepEqual(Array.from(run("a.subarray(E.POS,E.POS+3)")), [2,4,6]);
    run("a[E.LERP_SPEED]=0; a[E.VELOCITY_X]=3; updateEntities(2)");
    assert.deepEqual(Array.from(run("a.subarray(E.POS,E.POS+3)")), [8,4,6]);
    run("a[E.KIND]=0; spawn(1)");
    assert.deepEqual(Array.from(run("a.subarray(E.TARGET_POSITION,E.CONTROLLER+1)")), [0,0,0,0,0]);
});
