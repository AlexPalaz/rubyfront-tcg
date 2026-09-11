#!/usr/bin/env python3
"""I suoni del tavolo, montati a strati con ffmpeg.

Materie prime: i pacchetti CC0 di Kenney (www.kenney.nl) — RPG Audio,
Impact Sounds, Casino Audio — scompattati in una cartella con tre
sottocartelle `rpg/`, `impact/`, `casino/` (dentro ciascuna, `Audio/`).

    python3 scripts/sounds.py /cartella/dei/pacchetti

Ogni voce è una lista di strati (pacchetto, file, ritardo in ms, guadagno
in dB, filtro proprio); tutti passano dalla stessa catena: riverbero corto
(rumore rosa che decade in 0,35 s, mescolato al 18%), taglio sotto i 55 Hz
e sopra i 9,5 kHz, limitatore, coda che sfuma. Uscita: AAC (m4a) in
public/sounds, che ogni browser decodifica.
"""
import os, shlex, subprocess, sys

K = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("KENNEY", "")
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sounds")
W = os.path.join(os.path.dirname(__file__), "..", "node_modules", ".cache", "sounds")
os.makedirs(W, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
IR = os.path.join(W, "ir.wav")
subprocess.run(
    f'ffmpeg -loglevel error -y -f lavfi -i "anoisesrc=d=0.35:c=pink:r=44100:a=0.5" '
    f'-af "afade=t=out:st=0:d=0.35:curve=exp,highpass=f=250,lowpass=f=6000" {shlex.quote(IR)}',
    shell=True, check=True,
)


def src(pack, name):
    return os.path.join(K, pack, "Audio", f"{name}.ogg")


def sweep(start, end, seconds, steps=24):
    """Una spazzolata del taglio del passa-basso da `start` a `end` Hz in
    `seconds`: comandi a scalini per asendcmd (il filtro non interpola)."""
    cmds = []
    for i in range(steps + 1):
        t = seconds * i / steps
        f = start + (end - start) * (i / steps) ** 1.4
        cmds.append(f"{t:.3f} lowpass frequency {f:.0f}")
    return "asendcmd=c='" + ";".join(cmds) + "',lowpass=f=" + str(start)


def wind(seconds, colour, start, end, fade_in, fade_out_at, fade_out):
    """Il vento: rumore colorato che cresce e cala, con il taglio che si sposta."""
    return (
        ("lavfi", f"anoisesrc=d={seconds}:c={colour}:r=44100:a=0.7", 0, 0,
         f"{sweep(start, end, seconds)},highpass=f=90,afade=t=in:st=0:d={fade_in},afade=t=out:st={fade_out_at}:d={fade_out}")
    )


def build(name, layers):
    for p, f, _, _, _ in layers:
        assert p == "lavfi" or os.path.exists(src(p, f)), src(p, f)
    inputs = " ".join(
        (f"-f lavfi -i {shlex.quote(f)}" if p == "lavfi" else f"-i {shlex.quote(src(p, f))}") for p, f, _, _, _ in layers
    )
    chains = [
        f'[{i}:a]aresample=44100,aformat=channel_layouts=mono,{x + "," if x else ""}adelay={d}|{d},volume={g}dB[l{i}]'
        for i, (p, f, d, g, x) in enumerate(layers)
    ]
    n = len(layers)
    mix = "".join(f"[l{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:dropout_transition=0[dry]"
    post = (
        f"[dry]asplit=2[d1][d2];[d2][{n}:a]afir=dry=0:wet=1[wet];"
        "[d1][wet]amix=inputs=2:weights=1 0.18:normalize=0,highpass=f=55,lowpass=f=9500,"
        "alimiter=limit=0.89:level=0,afade=t=out:st=1.4:d=0.3,atrim=0:1.8[out]"
    )
    fc = ";".join(chains + [mix, post])
    out = os.path.join(OUT, f"{name}.m4a")
    subprocess.run(
        f'ffmpeg -loglevel error -y {inputs} -i {shlex.quote(IR)} -filter_complex "{fc}" -map "[out]" -c:a aac -b:a 128k {shlex.quote(out)}',
        shell=True, check=True,
    )
    print("ok", name)


# prendere, scegliere: cuoio in mano e carta che scivola
build("select-1", [("rpg", "handleSmallLeather", 0, -6, ""), ("casino", "card-slide-2", 20, -4, "highpass=f=200")])
build("select-2", [("rpg", "handleSmallLeather2", 0, -6, ""), ("casino", "card-slide-5", 20, -4, "highpass=f=200")])
# la pesca: la carta spinta dal mazzo con lo sfoglio di pergamena
build("draw-1", [("casino", "card-shove-1", 0, -3, ""), ("rpg", "bookFlip1", 30, -14, "highpass=f=400")])
build("draw-2", [("casino", "card-shove-2", 0, -3, ""), ("rpg", "bookFlip2", 30, -14, "highpass=f=400")])
build("draw-3", [("casino", "card-shove-3", 0, -3, ""), ("rpg", "bookFlip3", 30, -14, "highpass=f=400")])
# la carta sul Fronte: si posa, col libro chiuso e un colpo sordo sotto
build("play-1", [("casino", "card-place-1", 0, -2, ""), ("rpg", "bookPlace1", 10, -8, ""), ("impact", "impactSoft_medium_000", 15, -9, "lowpass=f=350")])
build("play-2", [("casino", "card-place-3", 0, -2, ""), ("rpg", "bookPlace2", 10, -8, ""), ("impact", "impactSoft_medium_001", 15, -9, "lowpass=f=350")])
# i tasti: lo scatto del fermaglio di metallo, con un tocco sordo
build("button-1", [("rpg", "metalClick", 0, -6, "highpass=f=300"), ("impact", "impactSoft_medium_002", 0, -16, "lowpass=f=500")])
build("button-2", [("rpg", "metalLatch", 0, -8, "highpass=f=300"), ("impact", "impactSoft_medium_003", 0, -16, "lowpass=f=500")])
# la fase nuova: la porta pesante, la campana intonata giù, il colpo grave
build("phase-1", [("rpg", "doorClose_1", 0, -4, "lowpass=f=900"), ("impact", "impactBell_heavy_000", 40, -12, "asetrate=44100*0.62,aresample=44100,lowpass=f=2500"), ("impact", "impactSoft_heavy_000", 0, -8, "lowpass=f=300")])
build("phase-2", [("rpg", "doorClose_2", 0, -4, "lowpass=f=900"), ("impact", "impactBell_heavy_002", 40, -12, "asetrate=44100*0.66,aresample=44100,lowpass=f=2500"), ("impact", "impactSoft_heavy_001", 0, -8, "lowpass=f=300")])
# l'attacco: la lama che esce e il taglio — pulito, senza il colpo di
# metallo (bocciato: «non va bene»)
build("attack-1", [("rpg", "drawKnife1", 0, -6, ""), ("rpg", "knifeSlice", 140, -4, ""), ("impact", "impactSoft_heavy_002", 150, -16, "lowpass=f=250")])
build("attack-2", [("rpg", "drawKnife2", 0, -6, ""), ("rpg", "knifeSlice2", 140, -4, ""), ("impact", "impactSoft_heavy_003", 150, -16, "lowpass=f=250")])
build("attack-3", [("rpg", "drawKnife3", 0, -6, ""), ("rpg", "knifeSlice", 140, -4, "asetrate=44100*0.95,aresample=44100"), ("impact", "impactSoft_heavy_001", 150, -16, "lowpass=f=250")])
# il blocco: lo scudo — piastra, legno pesante sotto, fermaglio sopra
build("block-1", [("impact", "impactPlate_heavy_000", 0, -5, ""), ("impact", "impactWood_heavy_000", 0, -6, "lowpass=f=700"), ("rpg", "metalLatch", 60, -14, "highpass=f=800"), ("impact", "impactSoft_heavy_004", 0, -9, "lowpass=f=250")])
build("block-2", [("impact", "impactPlate_heavy_003", 0, -5, ""), ("impact", "impactWood_heavy_002", 0, -6, "lowpass=f=700"), ("rpg", "metalLatch", 60, -14, "highpass=f=800"), ("impact", "impactSoft_heavy_001", 0, -9, "lowpass=f=250")])
# il tap (e lo stap): cuoio che si posa, filtrato, con un colpo morbido
# sotto — niente stoffa (frusciava, «metallico») e niente acuti
build("tap-1", [("rpg", "dropLeather", 0, -9, "lowpass=f=1400"), ("impact", "impactSoft_medium_004", 10, -14, "lowpass=f=420")])
build("tap-2", [("rpg", "dropLeather", 0, -9, "lowpass=f=1200,asetrate=44100*0.94,aresample=44100"), ("impact", "impactSoft_medium_000", 10, -14, "lowpass=f=420")])
build("tap-3", [("rpg", "dropLeather", 0, -9, "lowpass=f=1300,asetrate=44100*1.05,aresample=44100"), ("impact", "impactSoft_medium_001", 10, -14, "lowpass=f=420")])
# il contrattacco: il taglio, il metallo pesante, il rintocco
build("counter-1", [("rpg", "knifeSlice", 0, -5, ""), ("impact", "impactMetal_heavy_001", 120, -6, ""), ("rpg", "metalPot1", 130, -10, "highpass=f=600"), ("impact", "impactSoft_heavy_000", 120, -10, "lowpass=f=300")])
build("counter-2", [("rpg", "knifeSlice2", 0, -5, ""), ("impact", "impactMetal_heavy_003", 120, -6, ""), ("rpg", "metalPot2", 130, -10, "highpass=f=600"), ("impact", "impactSoft_heavy_002", 120, -10, "lowpass=f=300")])
# il Rubyfront in ingresso (dal 2026-09-11, «suoni differenti e adatti»,
# poi «tipo il vento»): tre momenti di vento sintetizzato — rumore
# colorato con la spazzolata del taglio — e sotto, dove serve, un tocco.
# — l'arrivo: la raffica che sale e passa (marrone, poi rosa sopra)
build("rubyfront-arrive-1", [wind(1.8, "brown", 180, 1500, 0.45, 0.9, 0.8), ("lavfi", "anoisesrc=d=1.8:c=pink:r=44100:a=0.4", 150, -14, "highpass=f=700,lowpass=f=2600,afade=t=in:st=0:d=0.5,afade=t=out:st=0.7:d=0.7")])
build("rubyfront-arrive-2", [wind(1.8, "brown", 220, 1200, 0.5, 0.95, 0.8), ("lavfi", "anoisesrc=d=1.8:c=pink:r=44100:a=0.4", 100, -15, "highpass=f=600,lowpass=f=2200,afade=t=in:st=0:d=0.45,afade=t=out:st=0.75:d=0.7")])
# — l'accensione: la raffica corta e alta, e il rubino che si accende
#   (la campana grave, lontana)
build("rubyfront-ignite-1", [wind(1.4, "pink", 400, 3200, 0.12, 0.45, 0.8), ("impact", "impactBell_heavy_001", 60, -14, "asetrate=44100*0.55,aresample=44100,lowpass=f=2600"), ("impact", "impactGlass_light_001", 80, -20, "highpass=f=1800")])
build("rubyfront-ignite-2", [wind(1.4, "pink", 350, 2800, 0.12, 0.45, 0.8), ("impact", "impactBell_heavy_003", 60, -14, "asetrate=44100*0.58,aresample=44100,lowpass=f=2600"), ("impact", "impactGlass_light_003", 80, -20, "highpass=f=1800")])
# — la posa: il vento che cala e si spegne, col colpo sordo della lastra
build("rubyfront-land-1", [wind(1.5, "brown", 1100, 120, 0.05, 0.5, 0.9), ("impact", "impactSoft_heavy_001", 40, -7, "lowpass=f=220"), ("impact", "impactPlate_heavy_001", 40, -16, "lowpass=f=900")])
build("rubyfront-land-2", [wind(1.5, "brown", 900, 140, 0.05, 0.5, 0.9), ("impact", "impactSoft_heavy_003", 40, -7, "lowpass=f=220"), ("impact", "impactPlate_heavy_003", 40, -16, "lowpass=f=900")])
