export interface RustyMemoryPart {
}

export function getRustyMemory(): RustyMemoryPart {
    if (typeof Memory.rusty !== "object") {
        Memory.rusty = {
        };
    }
    const rusty = Memory.rusty as RustyMemoryPart;
    return rusty;
}
