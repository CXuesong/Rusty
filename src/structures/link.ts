import _ from "lodash/index";

export const LINK_RESOURCE_HIGH_LEVEL = 0.8;
export const LINK_RESOURCE_LOW_LEVEL = 0.2;

interface RustyLinkRoomMemory {
    nextLinkCheckTime?: number;
}

export function onNextFrame(room: Room) {
    let memory = room.memory.rustyLink as RustyLinkRoomMemory;
    if (!memory || typeof memory !== "object") room.memory.rustyLink = memory = {};
    if (memory.nextLinkCheckTime == null || Game.time >= memory.nextLinkCheckTime) {
        memory.nextLinkCheckTime = Game.time + _.random(5, 10);
        const links = room.find(FIND_MY_STRUCTURES, { filter: s => s.structureType === "link" }) as StructureLink[];
        const hiLinks = _(links)
            .filter(l => l.cooldown === 0 && l.store.energy >= l.store.getCapacity(RESOURCE_ENERGY) * LINK_RESOURCE_HIGH_LEVEL)
            .orderBy(l => -l.store.energy)
            .value();
        const loLinks = _(links)
            .filter(l => l.cooldown === 0 && l.store.energy <= l.store.getCapacity(RESOURCE_ENERGY) * LINK_RESOURCE_LOW_LEVEL)
            .orderBy(l => l.store.energy)
            .value();
        if (!loLinks.length) return;
        for (const hiLink of hiLinks) {
            const loLink = _(loLinks)
                .filter(l => l.store.energy <= l.store.getCapacity(RESOURCE_ENERGY) * LINK_RESOURCE_LOW_LEVEL)
                .minBy(l => hiLink.pos.getRangeTo(l));
            const hiLinkCap = hiLink.store.getCapacity(RESOURCE_ENERGY);
            if (loLink) hiLink.transferEnergy(loLink, hiLink.store.energy - Math.ceil(hiLinkCap * LINK_RESOURCE_LOW_LEVEL + 10));
        }
    }
}
