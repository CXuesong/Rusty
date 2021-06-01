export function visualTextMultiline(visual: Room | RoomVisual, text: string | string[], x: number, y: number, style?: TextStyle): void {
    const v = visual instanceof Room ? visual.visual : visual;
    if (!Array.isArray(text)) text = [text];
    for (const t of text) {
        for (const l of t.split("\n")) {
            v.text(l, x, y, style);
            y++;
        }
    }
}
