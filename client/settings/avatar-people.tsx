import type { PluginTheme } from "@getpaseo/plugin";
import { Modal } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { AvatarImage, AvatarPerson } from "../../shared/piggery/avatar.ts";
import { AVATAR, AVATAR_SM, Avatar } from "../kit/avatar.tsx";
import { Button } from "../kit/button.tsx";
import { Pill } from "../kit/pill.tsx";
import { Rows } from "../kit/rows.tsx";
import { AVATAR_LG, RADIUS, SPACING, text } from "../kit/theme.ts";

const INLINE_PICTURES = 8;

function nameOf(person: AvatarPerson): string {
  return person.name ?? person.id;
}

function Thumb({ theme, imageId, index, colour, size, chosen, onPress }: { theme: PluginTheme; imageId: string; index: number; colour: string; size: number; chosen: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Picture ${index + 1}`} accessibilityState={{ selected: chosen }} style={(state) => ({ padding: 2, borderRadius: size, borderWidth: 2, borderColor: chosen ? theme.colors.accent : "transparent", opacity: state.pressed ? 0.7 : 1 })}>
      <Avatar theme={theme} name={`Picture ${index + 1}`} colour={colour} size={size} imageId={imageId} />
    </Pressable>
  );
}

function PictureGrid({ theme, person, images, colour, current, holdersOf, onPick, onClose }: { theme: PluginTheme; person: AvatarPerson; images: readonly AvatarImage[]; colour: string; current: string | undefined; holdersOf: (imageId: string) => string[]; onPick: (imageId: string) => void; onClose: () => void }) {
  return (
    <Modal title={`Picture for ${nameOf(person)}`} open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content contentContainerStyle={{ padding: SPACING[3], gap: SPACING[2] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACING[2] }}>
          {images.map((image, index) => {
            const holders = holdersOf(image.id);
            return (
              <View key={image.id} style={{ width: 72, alignItems: "center", gap: SPACING[0.5] }}>
                <Thumb theme={theme} imageId={image.id} index={index} colour={colour} size={AVATAR_LG} chosen={current === image.id} onPress={() => onPick(image.id)} />
                {holders.length > 0 ? (
                  <Text style={text(theme, "label")} numberOfLines={2}>
                    {holders.join(", ")}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      </Modal.Content>
    </Modal>
  );
}

function PersonRow({ theme, person, images, colour, current, needsPick, holdersOf, onPick, onClear }: { theme: PluginTheme; person: AvatarPerson; images: readonly AvatarImage[]; colour: string; current: string | undefined; needsPick: boolean; holdersOf: (imageId: string) => string[]; onPick: (imageId: string) => void; onClear: () => void }) {
  const [choosing, setChoosing] = useState(false);
  const name = nameOf(person);
  const others = current ? holdersOf(current).filter((holder) => holder !== name) : [];
  const inline = images.length <= INLINE_PICTURES;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], paddingVertical: SPACING[1.5], flexWrap: "wrap" }}>
      <Avatar theme={theme} name={name} colour={colour} size={AVATAR} imageId={current} />
      <View style={{ flex: 1, minWidth: 140 }}>
        <Text style={text(theme, "rowTitle")} numberOfLines={1}>
          {name}
          {person.team ? <Text style={text(theme, "label")}>{`  ${person.team}`}</Text> : null}
        </Text>
        {needsPick ? (
          <Text style={text(theme, "label", "accent")}>Pick a picture</Text>
        ) : others.length > 0 ? (
          <Text style={text(theme, "label")} numberOfLines={1}>
            Also used by {others.join(", ")}
          </Text>
        ) : null}
      </View>
      {inline ? (
        <View style={{ flexDirection: "row", gap: SPACING[0.5] }}>
          {images.map((image, index) => (
            <Thumb key={image.id} theme={theme} imageId={image.id} index={index} colour={colour} size={AVATAR_SM + 4} chosen={current === image.id} onPress={() => onPick(image.id)} />
          ))}
        </View>
      ) : (
        <Button theme={theme} label="Choose…" icon="Images" onPress={() => setChoosing(true)} />
      )}
      <View style={{ width: 64, alignItems: "flex-end" }}>{current !== undefined ? <Button theme={theme} label="Clear" onPress={onClear} /> : null}</View>
      {choosing ? (
        <PictureGrid
          theme={theme}
          person={person}
          images={images}
          colour={colour}
          current={current}
          holdersOf={holdersOf}
          onPick={(imageId) => {
            setChoosing(false);
            onPick(imageId);
          }}
          onClose={() => setChoosing(false)}
        />
      ) : null}
    </View>
  );
}

export function RolePeople({ theme, people, images, colour, picks, needsPick, onPick, onClear }: { theme: PluginTheme; people: readonly AvatarPerson[]; images: readonly AvatarImage[]; colour: string; picks: ReadonlyMap<string, string>; needsPick: ReadonlySet<string>; onPick: (personId: string, imageId: string) => void; onClear: (personId: string) => void }) {
  const [onlyUnpicked, setOnlyUnpicked] = useState(false);
  const unpicked = people.filter((person) => needsPick.has(person.id)).length;
  const shown = onlyUnpicked ? people.filter((person) => needsPick.has(person.id)) : people;
  const holdersOf = (imageId: string, of: AvatarPerson) => people.filter((person) => person.teamId === of.teamId && picks.get(person.id) === imageId).map(nameOf);
  if (people.length === 0) return null;
  return (
    <View style={{ gap: SPACING[1], borderRadius: RADIUS.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING[2], flexWrap: "wrap" }}>
        <Text style={text(theme, "label")}>
          {people.length} {people.length === 1 ? "person" : "people"}
          {unpicked > 0 ? ` · ${unpicked} still need a pick` : " · everyone has a picture"}
        </Text>
        {unpicked > 0 || onlyUnpicked ? <Pill theme={theme} label={onlyUnpicked ? "Showing who needs a pick" : `Needs a pick (${unpicked})`} colour={theme.colors.accent} filled={onlyUnpicked} onPress={() => setOnlyUnpicked(!onlyUnpicked)} /> : null}
      </View>
      <Rows theme={theme}>
        {shown.map((person) => (
          <PersonRow key={person.id} theme={theme} person={person} images={images} colour={colour} current={picks.get(person.id)} needsPick={needsPick.has(person.id)} holdersOf={(imageId) => holdersOf(imageId, person)} onPick={(imageId) => onPick(person.id, imageId)} onClear={() => onClear(person.id)} />
        ))}
      </Rows>
    </View>
  );
}
