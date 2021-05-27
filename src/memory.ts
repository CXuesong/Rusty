export interface SpawningCreepEntry {
    creep: string;
    memory: CreepMemory;
}

export interface RustyMemoryPart {
    clock: number;
}

export function getRustyMemory(): RustyMemoryPart {
    if (typeof Memory.rusty !== "object") {
        Memory.rusty = {
            clock: 0
        };
    }
    const rusty = Memory.rusty as RustyMemoryPart;
    if (typeof rusty.clock !== "number") rusty.clock = 0;
    return rusty;
}
