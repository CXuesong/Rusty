import _ from "lodash";

export function evadeBlockers(room: Room, cost: CostMatrix): void {
    const creeps = room.find(FIND_CREEPS);
    for (const c of creeps)
        cost.set(c.pos.x, c.pos.y, 255);
}

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

export function buildPathFinderGoals<T extends RoomObject>(goals: _.List<T>): Array<{ pos: RoomPosition; range: number, roomObject: T }> {
    return _(goals).map(g => {
        return { pos: g.pos, range: 1, roomObject: g };
    }).value();
}

export function findNearestPath<T extends RoomObject>(origin: RoomPosition, goals: _.List<T>, opts?: PathFinderOpts): {
    goal: T;
    path: RoomPosition[];
    cost: number;
} | undefined {
    const rawGoals = buildPathFinderGoals(goals);
    // No goals.
    if (!rawGoals.length) return undefined;
    const result = PathFinder.search(origin, rawGoals, opts);
    if (result.incomplete) return undefined;
    const lastPos = _(result.path).last() || origin;
    const goal = _(rawGoals).minBy(g => Math.abs(lastPos.getRangeTo(g.pos) - g.range));
    if (!goal) throw new Error("Unexpected failure when recovering RoomObject from position.");
    return {
        goal: goal.roomObject,
        path: result.path,
        cost: result.cost
    };
}