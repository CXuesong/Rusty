interface RustyCollectorRoomMemory {
    // <Id<CollectorCreepCollectPrimaryDestType>, untargetedSince>
    untargetedCollectables: Record<string, number>;
}

export function getRoomMemory(room: Room): RustyCollectorRoomMemory {
    let memory = room.memory.rustyCollector as RustyCollectorRoomMemory;
    if (!memory || typeof memory !== "object")
        room.memory.rustyCollector = memory = { untargetedCollectables: {} };
    return memory;
}
