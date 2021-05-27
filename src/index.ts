/// <reference path="./typings.d.ts" />

import * as RustyRoom from "./room";
import * as SpecializedCreeps from "./specializedCreeps";

export function loop() {
    console.log("Rusty primary loop: Started.")
    const startTime = performance.now();
    try {
        console.log("Time", Game.time);
        RustyRoom.onNextFrame();
        SpecializedCreeps.onNextFrame();
    } catch (err) {
        console.log("Rusty primary loop: Error.", err.stack || String(err));
    } finally {
        const duration = Math.round(performance.now() - startTime);
        console.log(`Rusty primary loop: Finished in ${duration}ms.`);
    }
}
