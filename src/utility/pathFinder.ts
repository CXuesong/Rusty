import _ from "lodash";

const walkableStructureTypes = new Set<StructureConstant>([
    STRUCTURE_ROAD,
    STRUCTURE_CONTAINER,
])

function evadeBlockers(room: Room, cost: CostMatrix): void {
    const blockers = _([
        room.find(FIND_CREEPS),
        room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_RAMPART ? !s.my && !s.isPublic : !walkableStructureTypes.has(s.structureType)
        })]).flatten();
    for (const b of blockers)
        cost.set(b.pos.x, b.pos.y, 255);
}

export function handleRoads(room: Room, cost: CostMatrix): void {
    for (const r of room.find(FIND_STRUCTURES, { filter: s => s.structureType === STRUCTURE_ROAD })) {
        cost.set(r.pos.x, r.pos.y, 1);
    }
}

function evadeHostileCreeps(room: Room, cost: CostMatrix): void {
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

let roomCostMatrixCache: undefined | {
    time: number;
    roomCostMatrix: Partial<Record<string, CostMatrix>>;
    roomCostMatrixNoEvadeHostileCreeps: Partial<Record<string, CostMatrix>>;
};

export interface RoomCostMatrixOptions {
    noEvadeHostileCreeps?: boolean;
}

export function buildRoomCostMatrix(room: Room, options?: RoomCostMatrixOptions): CostMatrix {
    if (roomCostMatrixCache?.time !== Game.time) {
        roomCostMatrixCache = {
            time: Game.time,
            roomCostMatrix: {},
            roomCostMatrixNoEvadeHostileCreeps: {}
        };
    }
    const { noEvadeHostileCreeps } = options || {};
    const costCache = noEvadeHostileCreeps ? roomCostMatrixCache.roomCostMatrixNoEvadeHostileCreeps : roomCostMatrixCache.roomCostMatrix;
    let cost = costCache[room.name];
    // if (cost) console.log("Cache hit " + room);
    if (!cost) {
        // console.log("Cache miss " + room);
        cost = new PathFinder.CostMatrix();
        handleRoads(room, cost);
        evadeBlockers(room, cost);
        if (!noEvadeHostileCreeps) evadeHostileCreeps(room, cost);
        costCache[room.name] = cost;
    }
    return cost.clone();
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
    // console.log("findNearestPath -> " + JSON.stringify(result.path));
    // console.log("findNearestPath -> " + result.cost);
    return {
        goal: goal.roomObject,
        path: result.path,
        cost: result.cost
    };
}