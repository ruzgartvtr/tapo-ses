export type TapoModel = {
  id: string;
  label: string;
  blurb: string;
  featured?: boolean;
};

/** Indoor and outdoor Tapo cameras that expose the two-way talk channel. */
export const TAPO_MODELS: TapoModel[] = [
  {
    id: "C210",
    label: "Tapo C210",
    blurb: "Pan ve tilt. Bu stüdyonun birincil hoparlörü.",
    featured: true,
  },
  { id: "C200", label: "Tapo C200", blurb: "Pan ve tilt, C210 ile aynı konuşma kanalı." },
  { id: "C220", label: "Tapo C220", blurb: "2K pan/tilt, iki yönlü ses." },
  { id: "C225", label: "Tapo C225", blurb: "Renkli gece görüşü, iki yönlü ses." },
  { id: "C100", label: "Tapo C100", blurb: "Sabit iç mekan, iki yönlü ses." },
  { id: "C110", label: "Tapo C110", blurb: "Sabit iç mekan, iki yönlü ses." },
  { id: "C310", label: "Tapo C310", blurb: "Dış mekan, siren ve konuşma." },
  { id: "C320WS", label: "Tapo C320WS", blurb: "Dış mekan renkli gece görüşü." },
  { id: "C500", label: "Tapo C500", blurb: "Dış mekan pan/tilt." },
  { id: "C510W", label: "Tapo C510W", blurb: "Dış mekan pan/tilt." },
  { id: "D230", label: "Tapo D230", blurb: "Kapı zili, iki yönlü ses." },
];

export function modelById(id: string): TapoModel {
  return TAPO_MODELS.find((model) => model.id === id) ?? TAPO_MODELS[0]!;
}
