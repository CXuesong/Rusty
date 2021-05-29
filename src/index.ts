/// <reference path="./typings.d.ts" />

import * as RustyRoom from "./room";
import * as SpecializedCreeps from "./specializedCreeps";

export function loop() {
    console.log(`Rusty primary loop: Started. Time: ${Game.time}; Bucket: ${Game.cpu.bucket}.`)
    // const startTime = performance.now();
    try {
        RustyRoom.onNextFrame();
        SpecializedCreeps.onNextFrame();
    } catch (err) {
        console.log("Rusty primary loop: Error.", err.stack || String(err));
    } finally {
        // const duration = Math.round(performance.now() - startTime);
        // console.log(`Rusty primary loop: Finished in ${duration}ms.`);
        console.log(`Rusty primary loop: CPU time: ${Math.round(Game.cpu.getUsed() * 1000) / 1000}.`);
    }
}
