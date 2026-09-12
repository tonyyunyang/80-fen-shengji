#!/usr/bin/env python3
"""After Eighty: an original, reproducible score and sound-palette audition.

Build-only dependencies: numpy 1.26.4, scipy 1.13.1, soundfile 0.13.1, ffmpeg.
No external recordings, soundfonts, melodies, or game audio are used.
The source stays separate from the production audio until listening review.
"""
from pathlib import Path
import json
import math
import subprocess
import hashlib
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/audio-design/after-eighty-v1'
OUT.mkdir(parents=True, exist_ok=True)
SR, BPM, BARS = 44100, 86, 32
BEAT = 60 / BPM
N = round(BARS * 4 * BEAT * SR)
DURATION = N / SR
rng = np.random.default_rng(8086)
TAU = 2 * np.pi
stems = {name: np.zeros((N, 2), dtype=np.float32) for name in ['keys', 'bass', 'melody', 'room', 'drums']}
events = []


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def filt(data, cutoff, kind='lowpass', order=2):
    return sosfilt(butter(order, cutoff, btype=kind, fs=SR, output='sos'), data).astype(np.float32)


def envelope(t, attack, decay, sustain=0, release=.2):
    a = np.minimum(1, t / max(attack, .0001))
    d = sustain + (1-sustain) * np.exp(-np.maximum(0, t-attack) / max(decay, .001))
    tail = np.minimum(1, np.maximum(0, (t[-1]-t) / max(release, .001))) ** 1.7
    return a * d * tail


def add(bus, data, beat, level=1, pan=0):
    start = round(beat * BEAT * SR) % N
    if data.ndim == 1:
        angle = (max(-1, min(1, pan)) + 1) * np.pi / 4
        data = np.column_stack((data * np.cos(angle), data * np.sin(angle)))
    data = data.astype(np.float32) * level
    # Wrap note tails into the opening so reverberation and sustained notes
    # continue naturally across the loop instead of being abruptly trimmed.
    while len(data):
        length = min(len(data), N-start)
        stems[bus][start:start+length] += data[:length]
        data = data[length:]
        start = 0


def keys(note, seconds, velocity=.7):
    t = np.arange(round(seconds * SR)) / SR
    f = hz(note)
    phase = TAU*f*t + .055*np.sin(TAU*.63*t + note*.19) + .018*np.sin(TAU*4.7*t)
    # A decaying tine component over a gentle fundamental, with no saw buzz.
    tine = np.sin(2*phase + .65*np.exp(-t/.09)*np.sin(3*phase))
    body = np.sin(phase + .13*np.exp(-t/.38)*np.sin(2*phase))
    wave = .72*body + .21*tine*np.exp(-t/.8) + .055*np.sin(3*phase)*np.exp(-t/.25)
    wave *= envelope(t, .008, 1.45, .06, .32)
    wave *= .965 + .035*np.sin(TAU*4.2*t + note)
    return filt(wave * velocity, 4200)


def bass(note, seconds, velocity=.7):
    t = np.arange(round(seconds*SR))/SR
    f = hz(note)
    phase = TAU*f*t - .11*np.exp(-t/.027)
    wave = np.sin(phase) + .20*np.sin(2*phase)*np.exp(-t/.2) + .09*np.sin(3*phase)*np.exp(-t/.1)
    return filt(np.tanh(wave*1.3)*envelope(t,.008,.37,.03,.07)*velocity, 600)


def bell(note, seconds, velocity=.6):
    t = np.arange(round(seconds*SR))/SR
    phase = TAU*hz(note)*t + .045*np.sin(TAU*.85*t+note)
    wave = np.sin(phase) + .30*np.sin(2*phase)*np.exp(-t/.6) + .09*np.sin(3.01*phase)*np.exp(-t/.18)
    return filt(wave*envelope(t,.009,1.05,.02,.33)*velocity, 4900)


def pad(notes, seconds):
    t = np.arange(round(seconds*SR))/SR
    wave = np.zeros((len(t),2))
    for i,note in enumerate(notes):
        for channel in [0,1]:
            f = hz(note)*2**(((-1 if channel==0 else 1)*3.5)/1200)
            phase = TAU*f*t+.06*np.sin(TAU*.19*t+i)
            wave[:,channel] += (np.sin(phase)+.09*np.sin(2*phase))/len(notes)
    e = envelope(t,.75,3.8,.55,.95)
    return np.column_stack([filt(wave[:,c]*e,1400) for c in [0,1]])


def kick():
    t = np.arange(round(.28*SR))/SR
    phase = TAU*(49*t + (126-49)*.022*(1-np.exp(-t/.022)))
    x = np.sin(phase)*envelope(t,.002,.065,0,.035)
    return np.tanh(x*1.25)*.8


def brush():
    t = np.arange(round(.19*SR))/SR
    noise = filt(rng.normal(0,1,len(t)),[1000,6800],'bandpass')
    body = np.sin(TAU*185*t)*np.exp(-t/.035)
    return (.45*noise+.17*body)*envelope(t,.004,.055,0,.035)


def hat(opened=False):
    t = np.arange(round((.19 if opened else .047)*SR))/SR
    noise = filt(rng.normal(0,1,len(t)),[5500,11500],'bandpass')
    return noise*envelope(t,.001,.055 if opened else .012,0,.008)


# Eight original voicings, including two brighter arrivals before returning
# to B minor. The melody below is newly written for these changes.
chords = [
    ('Bm9',35,[50,54,57,61,66]), ('E13',40,[50,56,61,66]),
    ('Amaj9',33,[49,52,56,59,64]), ('C#7b9',37,[53,59,62,68]),
    ('F#m9',30,[52,57,61,64,68]), ('Dmaj9',38,[54,57,61,64,69]),
    ('C#m7b5',37,[52,55,59,64]), ('F#7b9',30,[54,58,61,64,67]),
]
# beat offset, MIDI pitch, held beats: four eight-bar phrases with space
# between answers, rather than a lead playing continuously over the table.
phrases = [
    [(1.5,78,.6),(2.5,76,.4),(3.25,74,1.2), (6,73,.5),(7,71,.9),
     (9.5,76,1.2),(11.25,73,.65), (14,74,.65),(15,73,.45),
     (17,73,.5),(18,76,.7),(19.25,78,1.2), (22,76,.8),(23.5,73,.6),
     (25.5,71,1),(27,67,.7), (30,70,.7),(31,73,.7)],
    [(1,74,.6),(2,78,1),(3.5,81,.6), (5.5,80,.65),(7,78,.9),
     (9,76,.5),(10.25,73,.8),(11.5,71,1), (14,74,.65),(15.25,73,.45),
     (17.5,76,1),(19,73,.65), (22,69,.8),(23.25,73,.8),
     (26,71,.6),(27,67,.55), (29.5,66,1),(31,70,.8)],
    [(2,66,1.1), (6.5,68,.8),(7.5,73,.6), (10,71,1.4),
     (14.5,68,.7), (18,69,1.2), (22,73,1.3),
     (26,71,.8),(27.5,67,.7), (30.5,70,.9)],
    [(1.5,78,.7),(3,74,1), (6,73,.7),(7.25,71,.7),
     (9.5,76,.7),(10.5,78,.4),(11.25,80,1.1), (14,77,.6),(15,74,.7),
     (17.5,76,1.2),(19,73,.65), (21.5,69,.7),(23,66,1),
     (25.5,64,.8),(27,67,.7), (29,66,1.1),(31,70,.75)],
]

for bar in range(BARS):
    phrase = bar//8
    name,root,voicing = chords[bar%8]
    beat = bar*4
    density = .84 if phrase==2 else 1.0
    # Offbeat chord answers with a little hand-played spread and velocity.
    comp = [(0,.82,2.2),(2.65,.53,1.4)] if bar%2==0 else [(.15,.68,2.3),(2.5,.47,1.4)]
    if phrase==2:comp=comp[:1]
    for pos,velocity,held in comp:
        for i,note in enumerate(voicing):
            timing=beat+pos+i*.011+rng.uniform(-.008,.008)
            add('keys',keys(note,held*BEAT,velocity*rng.uniform(.94,1.04)),timing,.112* density,(i-2)*.18)
            events.append({'instrument':'keys','beat':round(timing,4),'note':note,'length':held})
    if bar%2==0:
        add('room',pad([n+12 for n in voicing[1:4]],8*BEAT+1.1),beat,.035)
    bass_notes=[(0,root,.88,.82),(1.55,root+12,.30,.36),(2.5,root+7,.63,.58),(3.5,chords[(bar+1)%8][1]+(1 if bar%2 else -1),.38,.45)]
    if phrase==2:bass_notes=[bass_notes[0],bass_notes[2]]
    for pos,note,held,velocity in bass_notes:
        add('bass',bass(note,held*BEAT,velocity),beat+pos,.19)
        events.append({'instrument':'bass','beat':beat+pos,'note':note,'length':held})
    # Dry, understated rhythm; a break in the third phrase makes the return
    # of the groove audible without turning the track into a celebration loop.
    for pos,velocity in [(0,.85),(2.0,.59),(2.75,.33)]:
        if phrase==2 and pos!=0:continue
        add('drums',kick(),beat+pos,.22*velocity)
    for pos in [1,3]:
        add('drums',brush(),beat+pos+rng.uniform(.012,.026),.12*density,-.12)
    for eighth in range(8):
        if phrase==2 and eighth%2==0:continue
        swung=.06 if eighth%2 else 0
        add('drums',hat(opened=eighth==7 and bar%4==3),beat+eighth*.5+swung+rng.uniform(-.006,.009),(.034 if eighth%2 else .024)*rng.uniform(.82,1.08),.27)
    if phrase!=2 and bar%8==7:
        add('drums',brush(),beat+3.65,.035,-.12)

for section,phrase in enumerate(phrases):
    for i,(beat,note,held) in enumerate(phrase):
        add('melody',bell(note,held*BEAT+.42,.64 if section!=2 else .50),section*32+beat,.09,math.sin(i*.57)*.22)
        events.append({'instrument':'melody','beat':section*32+beat,'note':note,'length':held})


def room(data, seed=22):
    ir_rng=np.random.default_rng(seed)
    length=round(SR*1.35)
    t=np.arange(length)/SR
    wet=np.zeros_like(data)
    for ch in [0,1]:
        impulse=filt(ir_rng.normal(0,1,length),5200)*np.exp(-t*5.8)
        impulse[:round(.024*SR)]=0
        impulse/=np.sqrt(np.sum(impulse**2))
        conv=fftconvolve(data[:,ch],impulse).astype(np.float32)
        wet[:,ch]=conv[:N]
        tail=conv[N:]
        wet[:len(tail),ch]+=tail
    return wet

musical=stems['keys']+stems['melody']+stems['room']
# Discrete, filtered stereo echoes leave the center clear for card sounds.
delay=np.zeros_like(musical)
for j,amount in enumerate([.18,.09,.045]):
    samples=round(BEAT*(.75+j*.75)*SR)
    delay+=np.roll(musical[:,::-1] if j%2==0 else musical,samples,axis=0)*amount
mix=musical+delay+room(musical)*.115+stems['bass']+stems['drums']
# Small parallel saturation rounds transients while preserving dynamics.
mix=.9*mix+.1*np.tanh(mix*1.5)/1.5
# Remove DC without disturbing the circular loop's boundary.
spectrum=np.fft.rfft(mix,axis=0)
frequency=np.fft.rfftfreq(N,1/SR)
spectrum*=((1-np.exp(-(frequency/28)**4))*(1/(1+(frequency/11200)**8)))[:,None]
mix=np.fft.irfft(spectrum,n=N,axis=0).astype(np.float32)
peak=float(np.max(np.abs(mix)))
mix*=min(.82/peak,2.0)
loop_jump=float(np.max(np.abs(mix[0]-mix[-1])))
assert loop_jump<.025, 'Unexpected discontinuity at the loop boundary'
wav=OUT/'after-eighty.wav'
sf.write(wav,mix,SR,subtype='PCM_24')

# A short foreground sound audition, independently authored for Eighty.
fx=np.zeros((SR*13,2),dtype=np.float32)
fx_rng=np.random.default_rng(8032)
fx_cues=[]
def place_fx(data,at,level=1,pan=0):
    start=round(at*SR);length=min(len(data),len(fx)-start)
    angle=(pan+1)*np.pi/4
    fx[start:start+length,0]+=data[:length]*level*np.cos(angle)
    fx[start:start+length,1]+=data[:length]*level*np.sin(angle)

def paper(length=.08,pitch=2700):
    t=np.arange(round(length*SR))/SR
    n=filt(fx_rng.normal(0,1,len(t)),[max(200,pitch*.4),min(14000,pitch*1.8)],'bandpass')
    return n*envelope(t,.003,length*.28,0,.015)

def wood(frequency=190,length=.11):
    t=np.arange(round(length*SR))/SR
    return (np.sin(TAU*frequency*t)+.2*np.sin(TAU*frequency*2.63*t))*envelope(t,.002,.025,0,.018)

for i in range(5):place_fx(paper(.041,3400+fx_rng.uniform(-300,300)),.5+i*.20,.17,-.35+i*.16)
fx_cues.append({'at':.5,'event':'dealing','description':'Five soft paper flicks'})
place_fx(paper(.08,2200),2.2,.25);place_fx(wood(),2.2,.32)
fx_cues.append({'at':2.2,'event':'single card','description':'Paper and a rounded felt-table tap'})
for i in range(3):place_fx(paper(.065,2000+i*140),3.4+i*.055,.23);place_fx(wood(170+i*22),3.4+i*.055,.19)
fx_cues.append({'at':3.4,'event':'tractor','description':'A short group landing'})
place_fx(paper(.15,1500),5.1,.22)
for i,note in enumerate([66,71,74]):place_fx(bell(note,.5,.5),5.17+i*.09,.20)
fx_cues.append({'at':5.1,'event':'points captured','description':'Paper sweep and three rising notes'})
for i,note in enumerate([66,71,74,78]):place_fx(bell(note,.7,.65),7.0+i*.08,.24)
place_fx(wood(120,.22),7.0,.27)
fx_cues.append({'at':7.0,'event':'80-point threshold','description':'A fuller bright accent'})
for i,note in enumerate([59,66,71,74,78]):place_fx(bell(note,1.3,.63),9.1+i*.12,.22)
place_fx(bass(35,1,.6),9.1,.26)
fx_cues.append({'at':9.1,'event':'round won','description':'A brief resolving flourish'})
fx*=.83/max(.83,float(np.max(np.abs(fx))))
sf.write(OUT/'table-sounds.wav',fx,SR,subtype='PCM_24')

for name in ['after-eighty','table-sounds']:
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(OUT/(name+'.wav')),
      '-c:a','libmp3lame','-b:a','192k','-metadata','artist=Eighty','-metadata','title='+('After Eighty' if name=='after-eighty' else 'Eighty — sound palette'),str(OUT/(name+'.mp3'))],check=True)
# The shorter listening sample begins at the same opening and fades gracefully.
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-t','36','-af','afade=t=in:d=0.12,afade=t=out:st=33:d=3',
 '-c:a','libmp3lame','-b:a','192k',str(OUT/'after-eighty-preview.mp3')],check=True)
manifest={'title':'After Eighty','titleZh':'八十分之后','version':'listening-draft-1','bpm':BPM,'meter':'4/4','tonalCenter':'B minor',
 'bars':BARS,'seconds':DURATION,'sampleRate':SR,'seed':8086,'composition':'Original note sequences and synthesis authored for Eighty; no external recordings or musical quotations.',
 'instruments':['electric tine keys','rounded bass','soft bell lead','stereo pad','brushed synthetic drums'],
 'loopBoundaryJump':loop_jump,'peak':float(np.max(np.abs(mix))),'rms':float(np.sqrt(np.mean(mix**2))),
 'fxCues':fx_cues,'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in OUT.glob('*.mp3')}}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n')
(OUT/'score-events.json').write_text(json.dumps(events,indent=2)+'\n')
print(json.dumps(manifest,indent=2,ensure_ascii=False))
