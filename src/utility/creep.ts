import _ from "lodash/index";

export type BodyPartProfile = Partial<Record<BodyPartConstant, number>>;

export function bodyPartProfileToArray(profile: BodyPartProfile): BodyPartConstant[] {
    return _(profile).flatMap((count, part) => _(count).times(() => part as BodyPartConstant)).value();
}

export function bodyPartArrayToProfile(body: Array<BodyPartConstant | { type: BodyPartConstant }>): BodyPartProfile {
    return _(body)
        .map(b => typeof b === "string" ? b : b.type)
        .groupBy()
        .mapValues(g => g.length).value();
}
