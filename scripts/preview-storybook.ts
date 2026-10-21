// HydraSkript - Storybook PDF preview
// Renders a sample children's book with the production PDF renderer so the
// storybook layout can be eyeballed without a database or generation run.
//
// Usage:
//   npx tsx scripts/preview-storybook.ts [--audience 0-5|6-9|10-14] [--out path.pdf] [--assets dir]
//
// --assets may contain cover.png, ch1.png, ch2.png, ch3.png (optional; the
// renderer draws a placeholder when an image is missing).

import fs from 'node:fs';
import path from 'node:path';
import { renderPDF, type ExportableBook } from '../src/lib/services/pdfRenderer';

function argValue(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const audience = argValue('--audience', '6-9');
const outPath = path.resolve(argValue('--out', 'storybook-preview.pdf'));
const assetsDir = argValue('--assets', '');

const asset = (name: string): string | null => {
  if (!assetsDir) return null;
  const p = path.resolve(assetsDir, name);
  return fs.existsSync(p) ? p : null;
};

const CHAPTER_ONE = `Poppy had been waiting all morning for the meadow to wake up. She pulled on her red rubber boots, clipped Biscuit's sparkly leash to his collar, and pushed open the little gate behind the cottage. Biscuit — a round, golden dog with one floppy ear and one ear that stood straight up like a toast rack — bolted straight for the tall grass.

"Wait for me!" Poppy laughed, chasing him between the buttercups.

Something glimmered near the old stone wall. Poppy knelt down and brushed aside the clover. A tiny door, no bigger than a teacup, stood open in the moss. Warm light spilled out, and a voice no louder than a bee said, "Oh my. A visitor."

Poppy lay on her tummy and peered inside. A little field mouse in a blue waistcoat stood in a hallway of polished acorn caps. "I am Miro," he said, bowing so deeply his whiskers touched the floor. "Our lanterns have gone out, and the Moonlight Meadow has forgotten how to glow. Only a Kind Heart can relight them."

Poppy looked at Biscuit. Biscuit looked at Poppy. His toast-rack ear twitched.

"We'll help," said Poppy.

Miro clapped his paws. He gave Poppy a thimble full of golden light and showed her the first lantern, hanging in the blackberry bushes. When Poppy held up the thimble, the lantern flickered — and woke. One by one the meadow lights blinked on, until the whole field sparkled like a bowl of stars.

"Thank you," whispered Miro. "Come back whenever the dark feels too big."

Poppy and Biscuit trotted home as the real moon rose over the cottage, golden and brave — exactly like the little light in the thimble.`;

const CHAPTER_TWO = `The next morning, a parcel sat on the doorstep. It was wrapped in leaf paper and tied with grass string. Inside lay a small silver compass with a smiling moon painted on its face, and a note in tidy mouse-handwriting: "For the next adventure. — Miro."

Poppy held the compass flat on her palm. The needle spun once, twice, and then pointed straight at the Whispering Woods at the end of the meadow.

Biscuit barked. The toast-rack ear stood very tall.

They followed the needle past the stone wall, past the singing stream, all the way to the edge of the trees, where the light turned green and gold and the path split in two. The compass needle trembled — and pointed at a fox kit sitting in the middle of the path, looking thoroughly lost.

"Excuse me," said the fox kit. "I've misplaced my family. And my courage. I think I left both of them somewhere near the bluebells."

Poppy knelt and offered the thimble-light, still glowing faintly in her pocket. "We'll look with you," she said.

Together they walked the bluebell path, three small adventurers and one very brave dog, while the compass hummed softly and pointed the way home.`;

const CHAPTER_THREE = `By the time the sun slid behind the hills, the fox kit had found his family waiting by the old oak, and the meadow was glowing brighter than Poppy had ever seen it. Miro stood on the stone wall and held up his lantern like a tiny lighthouse.

"The meadow remembers now," he said. "Because of you."

Poppy felt the thimble-warmth settle right behind her ribs. Biscuit yawned the biggest yawn in the world, and they walked home together through the softly glowing grass — two small heroes, ready for whatever the morning would bring.`;

const book: ExportableBook = {
  title: 'Poppy and the Moonlit Meadow',
  targetAudience: audience,
  genre: 'fantasy',
  coverImageUrl: asset('cover.png'),
  chapters: [
    {
      index: 0,
      title: 'The Little Door in the Wall',
      content: CHAPTER_ONE,
      illustrationUrl: asset('ch1.png'),
    },
    {
      index: 1,
      title: 'The Compass That Pointed at Courage',
      content: CHAPTER_TWO,
      illustrationUrl: asset('ch2.png'),
    },
    {
      index: 2,
      title: 'The Meadow Remembers',
      content: CHAPTER_THREE,
      illustrationUrl: asset('ch3.png'),
    },
  ],
};

async function main() {
  console.log(`Rendering sample "${book.title}" (audience ${audience})...`);
  const { buffer, pageCount } = await renderPDF(book);
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${(buffer.length / 1024).toFixed(0)} KB, ${pageCount} pages)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
