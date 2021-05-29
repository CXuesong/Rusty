export function evadeHostileCreeps(room: Room, cost: CostMatrix): void {
    const hostile = room.find(FIND_HOSTILE_CREEPS);
    for (const h of hostile) {
        const { x, y } = h.pos;
        if (h.getActiveBodyparts(RANGED_ATTACK)) {
            for (let xd = -3; xd <= 3; xd++)
                for (let yd = -3; yd <= 3; yd++)
                    cost.set(x + xd, y + yd, 255);
        } else if (h.getActiveBodyparts(ATTACK)) {
            for (let xd = -1; xd <= 1; xd++)
                for (let yd = -1; yd <= 1; yd++)
                    cost.set(x + xd, y + yd, 255);
        }
    }
}