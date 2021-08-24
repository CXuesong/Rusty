export function isStructureWalkable(structure: AnyStructure): boolean {
    return structure.structureType === STRUCTURE_ROAD
        || structure.structureType === STRUCTURE_CONTAINER
        || structure.structureType === STRUCTURE_RAMPART && (structure.my || structure.isPublic);
}

export function isWalkableByLookAtResult(lookAtResult: LookAtResult | LookAtResult[]): boolean {
    if (Array.isArray(lookAtResult))
        return lookAtResult.every(r => isWalkableByLookAtResult(r));
    switch (lookAtResult.type) {
        case 'creep':
            return false;
        case 'structure':
            return isStructureWalkable(lookAtResult.structure as AnyStructure);
    }
    return true;
}
