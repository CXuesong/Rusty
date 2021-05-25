import { getRustyMemory } from "./memory";
import * as RustyRoom from "./room";
import * as SpecializedCreeps from "./specializedCreeps";

export function loop() {
    console.log("Rusty primary loop: Started.")
    try {
        const rusty = getRustyMemory();
        rusty.clock++;
        console.log("Clock", rusty.clock);
        RustyRoom.onNextFrame();
        SpecializedCreeps.onNextFrame();
    } catch (err) {
        console.log("Rusty primary loop: Error.", err.stack || String(err));
    } finally {
        console.log("Rusty primary loop: Finished.")
    }
}
