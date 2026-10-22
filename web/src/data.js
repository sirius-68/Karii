/* =====================================================================
   Lectern catalog
   - Karaoke: public-domain songs. Melodies and chords are encoded as
     notes so the app can synthesise an arrangement (with or without a
     guide melody) and derive exact lyric timing.
   - Poems: originals written for Lectern (more come live from PoetryDB).
   - Movie lines: original scenes written for Lectern.
   - Instrumentals: Tanner Helland, CC BY 4.0 (3 embedded, rest streamed).
   ===================================================================== */
const SONGS = [
  { id:'k-twinkle', title:'Twinkle, Twinkle, Little Star', artist:'Traditional', credit:'Lyrics: Jane Taylor (1806) · Public domain', bpm:96, bar:4, genre:'Lullaby',
    lines:[
      {t:'Twinkle, twinkle, little star,', n:'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2', c:'C:4 F:2 C:2'},
      {t:'How I wonder what you are!',     n:'F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2', c:'F:2 C:2 G:2 C:2'},
      {t:'Up above the world so high,',    n:'G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2', c:'C:2 F:2 C:2 G:2'},
      {t:'Like a diamond in the sky.',     n:'G4:1 G4:1 F4:1 F4:1 E4:1 E4:1 D4:2', c:'C:2 F:2 C:2 G:2'},
      {t:'Twinkle, twinkle, little star,', n:'C4:1 C4:1 G4:1 G4:1 A4:1 A4:1 G4:2', c:'C:4 F:2 C:2'},
      {t:'How I wonder what you are!',     n:'F4:1 F4:1 E4:1 E4:1 D4:1 D4:1 C4:2', c:'F:2 C:2 G:2 C:2'}
    ]},
  { id:'k-birthday', title:'Happy Birthday to You', artist:'Traditional', credit:'Melody: Hill sisters (1893) · Public domain', bpm:100, bar:3, genre:'Celebration', personal:true,
    lines:[
      {t:'Happy birthday to you,',       n:'G4:.75 G4:.25 A4:1 G4:1 C5:1 B4:3', c:'C:1 C:3 G:3'},
      {t:'Happy birthday to you,',       n:'G4:.75 G4:.25 A4:1 G4:1 D5:1 C5:3', c:'G:1 G:3 C:3'},
      {t:'Happy birthday, dear {name},', n:'G4:.75 G4:.25 G5:1 E5:1 C5:1 B4:1 A4:2', c:'C:1 C:3 F:3'},
      {t:'Happy birthday to you!',       n:'F5:.75 F5:.25 E5:1 C5:1 D5:1 C5:3', c:'F:1 C:2 G:1 C:3'}
    ]},
  { id:'k-susanna', title:'Oh! Susanna', artist:'Stephen Foster', credit:'Stephen Foster (1848) · Public domain', bpm:120, bar:4, genre:'Folk',
    lines:[
      {t:'Oh, I come from Alabama',          n:'C4:.5 D4:.5 E4:1 G4:1 G4:1.5 A4:.5 G4:1 E4:1 C4:1.5 D4:.5', c:'C:7 G:2'},
      {t:'With my banjo on my knee,',        n:'E4:1 E4:1 D4:1 C4:1 D4:3 R:1', c:'C:4 G:4'},
      {t:"I'm going to Louisiana,",          n:'E4:1 G4:1 G4:1.5 A4:.5 G4:1 E4:1 C4:1.5 D4:.5', c:'C:6 G:2'},
      {t:'My true love for to see.',         n:'E4:1 E4:1 D4:1 D4:1 C4:4', c:'G:4 C:4'},
      {t:'Oh! Susanna,',                     n:'F4:2 F4:1 A4:1 A4:3 R:1', c:'F:8'},
      {t:"Oh, don't you cry for me,",        n:'G4:1 G4:1 E4:1 C4:1 D4:3 R:1', c:'C:4 G:4'},
      {t:'For I come from Alabama',          n:'E4:1 G4:1 G4:1.5 A4:.5 G4:1 E4:1 C4:1.5 D4:.5', c:'C:6 G:2'},
      {t:'With my banjo on my knee.',        n:'E4:1 E4:1 D4:1 D4:1 C4:4', c:'G:4 C:4'}
    ]},
  { id:'k-jingle', title:'Jingle Bells', artist:'James Lord Pierpont', credit:'J. L. Pierpont (1857) · Public domain', bpm:128, bar:4, genre:'Holiday',
    lines:[
      {t:'Jingle bells, jingle bells,',        n:'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2', c:'C:8'},
      {t:'Jingle all the way!',                n:'E4:1 G4:1 C4:1.5 D4:.5 E4:4', c:'C:8'},
      {t:'Oh, what fun it is to ride',         n:'F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5', c:'F:4 C:4'},
      {t:'In a one-horse open sleigh, hey!',   n:'E4:1 D4:1 D4:1 E4:1 D4:2 G4:2', c:'D:4 G:4'},
      {t:'Jingle bells, jingle bells,',        n:'E4:1 E4:1 E4:2 E4:1 E4:1 E4:2', c:'C:8'},
      {t:'Jingle all the way!',                n:'E4:1 G4:1 C4:1.5 D4:.5 E4:4', c:'C:8'},
      {t:'Oh, what fun it is to ride',         n:'F4:1 F4:1 F4:1.5 F4:.5 F4:1 E4:1 E4:1 E4:.5 E4:.5', c:'F:4 C:4'},
      {t:'In a one-horse open sleigh!',        n:'G4:1 G4:1 F4:1 D4:1 C4:4', c:'G:4 C:4'}
    ]},
  { id:'k-auld', title:'Auld Lang Syne', artist:'Robert Burns', credit:'Robert Burns (1788) · Public domain', bpm:80, bar:4, genre:'Folk',
    lines:[
      {t:'Should auld acquaintance be forgot,', n:'G3:1 C4:1.5 B3:.5 C4:1 E4:1 D4:1.5 C4:.5 D4:1 E4:1', c:'G:1 C:4 G:4'},
      {t:'And never brought to mind?',          n:'C4:1.5 C4:.5 E4:1 G4:1 A4:3', c:'C:4 F:3'},
      {t:'Should auld acquaintance be forgot,', n:'A4:1 G4:1.5 E4:.5 E4:1 C4:1 D4:1.5 C4:.5 D4:1 E4:1', c:'F:1 C:4 G:4'},
      {t:'And auld lang syne?',                 n:'C4:1.5 A3:.5 A3:1 G3:1 C4:3', c:'C:2 F:2 C:3'},
      {t:'For auld lang syne, my dear,',        n:'A4:1 G4:1.5 E4:.5 E4:1 C4:1 D4:1.5 C4:.5 D4:1 A4:1', c:'F:1 C:4 G:4'},
      {t:'For auld lang syne,',                 n:'G4:1.5 E4:.5 E4:1 G4:1 A4:3', c:'C:4 F:3'},
      {t:"We'll tak a cup o' kindness yet,",    n:'C5:1 G4:1.5 E4:.5 E4:1 C4:1 D4:1.5 C4:.5 D4:1 E4:1', c:'F:1 C:4 G:4'},
      {t:'For auld lang syne.',                 n:'C4:1.5 A3:.5 A3:1 G3:1 C4:3', c:'C:2 F:1 G:1 C:3'}
    ]},
  { id:'k-rowboat', title:'Row, Row, Row Your Boat', artist:'Traditional', credit:'Traditional (1852) · Public domain', bpm:100, bar:3, genre:'Round',
    lines:[
      {t:'Row, row, row your boat,',              n:'C4:1.5 C4:1.5 C4:1 D4:.5 E4:1.5', c:'C:6'},
      {t:'Gently down the stream.',               n:'E4:1 D4:.5 E4:1 F4:.5 G4:3', c:'C:6'},
      {t:'Merrily, merrily, merrily, merrily,',   n:'C5:.5 C5:.5 C5:.5 G4:.5 G4:.5 G4:.5 E4:.5 E4:.5 E4:.5 C4:.5 C4:.5 C4:.5', c:'C:6'},
      {t:'Life is but a dream.',                  n:'G4:1 F4:.5 E4:1 D4:.5 C4:3', c:'G:3 C:3'},
      {t:'Row, row, row your boat,',              n:'C4:1.5 C4:1.5 C4:1 D4:.5 E4:1.5', c:'C:6'},
      {t:'Gently down the stream.',               n:'E4:1 D4:.5 E4:1 F4:.5 G4:3', c:'C:6'},
      {t:'Merrily, merrily, merrily, merrily,',   n:'C5:.5 C5:.5 C5:.5 G4:.5 G4:.5 G4:.5 E4:.5 E4:.5 E4:.5 C4:.5 C4:.5 C4:.5', c:'C:6'},
      {t:'Life is but a dream.',                  n:'G4:1 F4:.5 E4:1 D4:.5 C4:3', c:'G:3 C:3'}
    ]},
  { id:'k-mary', title:'Mary Had a Little Lamb', artist:'Sarah Josepha Hale', credit:'Sarah Josepha Hale (1830) · Public domain', bpm:112, bar:4, genre:'Nursery',
    lines:[
      {t:'Mary had a little lamb,',        n:'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2', c:'C:4 G:2 C:2'},
      {t:'Little lamb, little lamb,',      n:'D4:1 D4:1 D4:2 E4:1 G4:1 G4:2', c:'G:4 C:4'},
      {t:'Mary had a little lamb,',        n:'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1', c:'C:8'},
      {t:'Its fleece was white as snow.',  n:'D4:1 D4:1 E4:1 D4:1 C4:4', c:'G:4 C:4'},
      {t:'And everywhere that Mary went,', n:'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:2', c:'C:4 G:2 C:2'},
      {t:'Mary went, Mary went,',          n:'D4:1 D4:1 D4:2 E4:1 G4:1 G4:2', c:'G:4 C:4'},
      {t:'Everywhere that Mary went,',     n:'E4:1 D4:1 C4:1 D4:1 E4:1 E4:1 E4:1 E4:1', c:'C:8'},
      {t:'The lamb was sure to go.',       n:'D4:1 D4:1 E4:1 D4:1 C4:4', c:'G:4 C:4'}
    ]},
  { id:'k-sleeping', title:'Are You Sleeping?', artist:'Traditional', credit:'Frère Jacques, traditional (18th c.) · Public domain', bpm:104, bar:4, genre:'Round',
    lines:[
      {t:'Are you sleeping, are you sleeping,', n:'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1', c:'C:8'},
      {t:'Brother John, Brother John?',         n:'E4:1 F4:1 G4:2 E4:1 F4:1 G4:2', c:'C:8'},
      {t:'Morning bells are ringing, morning bells are ringing,', n:'G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1', c:'C:8'},
      {t:'Ding, dang, dong. Ding, dang, dong.', n:'C4:1 G3:1 C4:2 C4:1 G3:1 C4:2', c:'C:1 G:1 C:2 C:1 G:1 C:2'},
      {t:'Are you sleeping, are you sleeping,', n:'C4:1 D4:1 E4:1 C4:1 C4:1 D4:1 E4:1 C4:1', c:'C:8'},
      {t:'Brother John, Brother John?',         n:'E4:1 F4:1 G4:2 E4:1 F4:1 G4:2', c:'C:8'},
      {t:'Morning bells are ringing, morning bells are ringing,', n:'G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1 G4:.5 A4:.5 G4:.5 F4:.5 E4:1 C4:1', c:'C:8'},
      {t:'Ding, dang, dong. Ding, dang, dong.', n:'C4:1 G3:1 C4:2 C4:1 G3:1 C4:2', c:'C:1 G:1 C:2 C:1 G:1 C:2'}
    ]}
];

const ORIGINAL_POEMS = [
  {id:'p-redlight', title:'Before the Red Light', form:'Sonnet', body:
"The room is hushed, the lens a patient eye,\nmy pages squared and waiting on the stand.\nI count my breath the way the old clocks sigh,\nand feel the opening line beneath my hand.\nWhat frightened me was never all the faces —\nit was the gap between the word and me,\nthe little stumble, all the empty spaces\nwhere something true was trying to break free.\nSo let the scroll begin its steady climb;\nI'll meet each phrase as if it came from home.\nI do not need to get it right this time,\nI only need to make the words my own.\n\nAnd when the light goes dark and I am done,\nI'll know the voice was mine, and only one."},
  {id:'p-haiku', title:'Three Haiku for Morning', form:'Haiku', body:
"Kettle starts to hum —\nthe window learns its colour\none pane at a time.\n\nFrost on the railing\nwrites a sentence in white chalk.\nThe sun rubs it out.\n\nBus brakes, a dog barks,\nsomeone laughing two floors down.\nThe day has begun."},
  {id:'p-smallhours', title:'Small Hours', form:'Free verse', body:
"At three a.m. the house\nadmits what it is made of:\nthe fridge's long vowel,\na pipe clearing its throat,\nthe clock that never learned to whisper.\n\nI lie still and listen\nthe way you listen to a friend\nwho finally tells you the real story —\nnot to answer,\njust to stay.\n\nBy four the birds begin,\nuninvited, certain,\nas if someone had to go first\nand it might as well be them."},
  {id:'p-lighthouse', title:"The Lighthouse Keeper's Ballad", form:'Ballad', body:
"He kept the lamp on Harrow Point\nfor forty years and three,\nand never once let darkness win\nits argument with sea.\n\nHe trimmed the wick at half past six,\nhe wound the brass by eight,\nand when the fishing boats came home\nhe'd tell them they were late.\n\nThey say the night his lamp went out\nno ship was lost at sea,\nfor every window in the town\nwas lit for him to see.\n\nSo if you pass by Harrow Point\nand find a light burns low,\nit's only someone keeping watch\nthe way he used to know."},
  {id:'p-inventory', title:'Inventory', form:'Free verse', body:
"In the drawer by the door:\none key to a flat we left in spring,\na birthday candle, bent,\nthree coins from a country I can't name,\nyour handwriting on a receipt\nthat says only milk, bread, call mum.\n\nI keep meaning to sort it.\nI keep meaning to throw something away.\nBut every time I open it\nthe whole of us falls out,\nsmall and ordinary and still here,\nand I close it gently,\nlike a book I'm not finished with."},
  {id:'p-pause', title:'Ode to the Pause', form:'Ode', body:
"Praise the pause,\nthe held breath before the punchline,\nthe beat after \"I'm sorry\"\nwhere the words are allowed to land.\n\nPraise the comma,\nthat small bow in the middle of a sentence,\nthe rest in the bar of music\nthe drummer plays by playing nothing.\n\nPraise the silence on the phone\nwhen neither of you hangs up.\nPraise the dark between the stars\nthat lets us see them.\n\nSpeak slowly, friend.\nThe pause is not the absence of the song.\nIt is where the song decides\nwhat it means."},
  {id:'p-startingover', title:'For Someone Starting Over', form:'Couplets', body:
"You don't need the whole map, only the next street,\nthe scuff of a new pavement under your feet.\nYou don't need to know who you'll be in a year;\nit's enough, for today, to have made it here.\n\nPack light. Leave the heavy things by the door —\nthe \"should have\", the \"if only\", the \"never before\".\nThe road doesn't care how you came to begin.\nIt opens the same for whoever walks in.\n\nSo step out. Be clumsy. Be early, be late.\nThe life that is waiting is willing to wait."},
  {id:'p-river', title:'What the River Said', form:'Free verse', body:
"I asked the river how it knew the way.\nIt said: I don't. I only know down.\n\nI asked it how it carved the canyon walls.\nIt said: I didn't. I only kept on.\n\nI asked if it was tired after all these years.\nIt laughed in a thousand small stones\nand said: Tired is for things that think they're going somewhere.\nI'm not going. I'm here, and here, and here."}
];

const MOVIE_LINES = [
  {id:'m-noir', title:'The Last Client', genre:'Noir', role:'Private eye', level:'Easy', body:
"The rain had been falling for three days, the kind of rain that washes nothing clean.\n\n[beat]\n\nShe walked into my office like trouble wearing perfume, and I knew two things right away. One: she was lying. Two: I was going to take the case anyway.\n\n[lean in]\n\nMoney's money, sweetheart. But the truth? The truth costs extra."},
  {id:'m-captain', title:'Hold the Line', genre:'Sci-fi', role:'Starship captain', level:'Medium', body:
"Listen to me. All of you.\n\n[pause]\n\nThe shields are failing, the engines are gone, and the nearest friendly ship is nine hours away. I won't pretend that's good news.\n\nBut I've served with every one of you. I've watched you do impossible things on an ordinary Tuesday.\n\n[steady]\n\nSo we hold this line. Not because we're sure we'll win — because someone has to, and today, it's us."},
  {id:'m-kitchen', title:'Kitchen Table', genre:'Drama', role:'Estranged sibling', level:'Hard', body:
"You don't get to do that. You don't get to walk back in here after six years and sit at this table like nothing happened.\n\n[breathe]\n\nI kept your chair. Did you know that? Mum wanted to give it away, and I said no. I said he'll be back.\n\n[softer]\n\nI just didn't think it would take this long."},
  {id:'m-toast', title:'The Best Man', genre:'Comedy', role:'Best man', level:'Easy', body:
"For those who don't know me, I'm the best man — a title I gave myself after Dave's first three choices said no.\n\n[smile]\n\nDave and I go way back. Back to when he thought cologne was a substitute for showering. Sarah, you've changed him. He showers now. Mostly.\n\n[raise glass]\n\nTo the happy couple — may your love be patient, and your Wi-Fi strong."},
  {id:'m-crown', title:'Crown of Ash', genre:'Fantasy', role:'Young queen', level:'Hard', body:
"You kneel to me now. But where were you when the northern gates fell? Where were your banners when my father's halls burned?\n\n[rise]\n\nI am not the child you remember. The fire took my home, my family, my name. It left me only this crown — and the memory of every one of you who ran.\n\n[cold]\n\nStand up. I have no use for your knees. I need your swords."},
  {id:'m-call', title:'Fourteen Minutes', genre:'Thriller', role:'Anonymous caller', level:'Medium', body:
"Don't hang up. Please. Just listen.\n\n[lower your voice]\n\nThere's a device under the third row of the concert hall. It's on a timer, and I'm the only one who knows how to stop it.\n\nI'm not asking you to trust me. I'm asking you to check. You have fourteen minutes.\n\n[beat]\n\nThirteen now."},
  {id:'m-halftime', title:'Halftime', genre:'Sports', role:'Coach', level:'Medium', body:
"Look at the scoreboard. Go on, look at it.\n\n[pause]\n\nTwenty points. That's what everyone out there is looking at. But I'm looking at you.\n\nI've seen you run drills in the snow at six in the morning. I've seen you play through pain nobody else even knew about.\n\n[build]\n\nTwenty points is nothing. Twenty points is a story we tell later. Now get out there and write it."},
  {id:'m-platform', title:'Platform Nine', genre:'Romance', role:'The one who stayed', level:'Easy', body:
"I almost didn't come. I stood outside the station for twenty minutes trying to think of something clever to say.\n\n[laugh]\n\nI've got nothing clever. I've just got this: I've thought about you every single day since that train pulled away.\n\n[step closer]\n\nIf you're getting on another one, fine. But I needed you to know — I'd wait on this platform forever."}
];

const TH_BASE='https://raw.githubusercontent.com/tannerhelland/free-music/master/mp3/';
const INSTRUMENTALS = [
  {id:'i-remember', title:'Remember', mood:'Reflective', dur:63, embed:'remember'},
  {id:'i-home', title:'Home', mood:'Warm', dur:90, embed:'home'},
  {id:'i-millie', title:'Leaving Millie', mood:'Live piano', dur:153, embed:'millie'},
  {id:'i-tears', title:'Hidden Tears', mood:'Tender', dur:106, file:'Hidden Tears.mp3'},
  {id:'i-daybreak', title:'Daybreak', mood:'Hopeful', dur:114, file:'Daybreak.mp3'},
  {id:'i-islands', title:'Lost Islands', mood:'Dreamy', dur:94, file:'Lost Islands.mp3'},
  {id:'i-forest', title:'The Forest Awakes', mood:'Cinematic', dur:125, file:'The Forest Awakes.mp3'},
  {id:'i-memory', title:'A Memory Away', mood:'Nostalgic', dur:126, file:'A Memory Away.mp3'},
  {id:'i-waters', title:'Wild Waters', mood:'Epic', dur:82, file:'Wild Waters.mp3'},
  {id:'i-never', title:'Now or Never', mood:'Driving', dur:86, file:'Now or Never.mp3'}
];

const CLASSIC_POETS = ['Emily Dickinson','William Shakespeare','Christina Rossetti','William Blake','John Keats','Percy Bysshe Shelley','Robert Burns','Walt Whitman','Edgar Allan Poe','Elizabeth Barrett Browning'];
