import { getRustyMemory } from "./memory";

export function loop() {
    console.log("Rusty primary loop: Started.")
    try {
        const rusty = getRustyMemory();
        rusty.clock++;
        console.log("Clock", rusty.clock);
        Game.spawns["Spawn1"]
    } catch (err) {
        console.log("Rusty primary loop: Error.", err);
    } finally {
        console.log("Rusty primary loop: Finished.")
    }
}
