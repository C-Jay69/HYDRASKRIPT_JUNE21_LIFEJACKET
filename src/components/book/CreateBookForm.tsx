'use client';

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Sparkles, BookOpen, Loader2, Users, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { createBook, startGeneration, listStyleProfiles } from '@/lib/api';
import type { StyleProfileData } from '@/lib/api';
import type { TargetAudience, Genre, ColoringTheme } from '@/types';
import { CREDIT_COSTS, AUDIENCE_CONFIG, COLORING_THEMES, KIDS_ADVENTURES } from '@/types';
import { toast } from '@/hooks/use-toast';
import GenerationProgress from '@/components/book/GenerationProgress';

const GENRES: { value: Genre; label: string }[] = [
  { value: 'fiction',    label: 'Fiction' },
  { value: 'fantasy',   label: 'Fantasy' },
  { value: 'sci-fi',    label: 'Science Fiction' },
  { value: 'mystery',   label: 'Mystery' },
  { value: 'thriller',  label: 'Thriller' },
  { value: 'noir',      label: 'Noir' },
  { value: 'romance',   label: 'Romance' },
  { value: 'horror',    label: 'Horror' },
  { value: 'children',  label: "Children's" },
  { value: 'young-adult', label: 'Young Adult' },
  { value: 'coloring',  label: 'Coloring Book' },
  { value: 'poetry',    label: 'Poetry' },
  { value: 'non-fiction', label: 'Non-Fiction' },
  { value: 'self-help', label: 'Self-Help' },
  { value: 'biography', label: 'Biography' },
];

const AUDIENCES: { value: TargetAudience; label: string; description: string }[] = [
  { value: 'adult',  label: 'Adult',       description: 'Full-length books, complex themes' },
  { value: '10-14',  label: 'Ages 10-14',  description: 'Middle grade — 25 illustrated pages' },
  { value: '6-9',    label: 'Ages 6-9',    description: 'Early reader — 15 illustrated pages' },
  { value: '0-5',    label: 'Ages 0-5',    description: 'Picture book — 8 illustrated pages' },
];

const isKidsAudience = (a: string) => ['0-5', '6-9', '10-14'].includes(a);

export default function CreateBookForm() {
  const { setCurrentView, setSelectedBookId, setIsGenerating, setActiveJobId, profile } = useAppStore();

  const [title, setTitle]                     = useState('');
  const [description, setDescription]         = useState('');
  const [genre, setGenre]                     = useState<string>('');
  const [targetAudience, setTargetAudience]   = useState<string>('');
  const [styleProfileId, setStyleProfileId]   = useState<string>('');
  const [chapterCount, setChapterCount]       = useState<number>(0);
  const hasManuallySetChapters = useRef(false);
  const [coloringTheme, setColoringTheme]     = useState<string>('');
  const [adventureType, setAdventureType]     = useState<string>('');
  // Kids book character names: index 0 = hero/main character, 1-4 = friends
  const [heroName, setHeroName]               = useState('');
  const [friendNames, setFriendNames]         = useState<string[]>(['', '', '', '']);
  const [styleProfiles, setStyleProfiles]     = useState<StyleProfileData[]>([]);
  const [isCreating, setIsCreating]           = useState(false);
  const [activeGenerationJobId, setActiveGenerationJobId] = useState<string | null>(null);
  const [generationGenre, setGenerationGenre] = useState<string>('');

  const isKids = isKidsAudience(targetAudience);
  const isColoringBook = genre === 'coloring';
  // "Personalise the Story" (adventure setting, hero/friend names) only makes
  // sense for storybooks. Coloring books are page-based — the audience just
  // decides how many pages/line-art images to generate.
  const showKidsPersonalization = isKids && !isColoringBook;

  const handleGenreChange = (value: string) => {
    setGenre(value);
    if (value !== 'coloring') setColoringTheme('');
    
    // If user selects 'children', auto-set target audience to a kids range if it's currently 'adult'
    if (value === 'children' && targetAudience === 'adult') {
      setTargetAudience('6-9'); // Default to the middle kids range
    }
  };

  useEffect(() => { listStyleProfiles().then(setStyleProfiles); }, []);

  // Auto-fill chapter count from audience config
  useEffect(() => {
    if (targetAudience && !hasManuallySetChapters.current) {
      const config = AUDIENCE_CONFIG[targetAudience as TargetAudience];
      if (config) setChapterCount(config.defaultChapters);
    }
    if (!isKidsAudience(targetAudience)) {
      setAdventureType('');
      setHeroName('');
      setFriendNames(['', '', '', '']);
    }
  }, [targetAudience]);

  const estimateCredits = (): number => {
    if (!targetAudience || !chapterCount) return 0;
    if (genre === 'coloring') {
      const imageCount = chapterCount + 1;
      return CREDIT_COSTS.outlineGeneration + (CREDIT_COSTS.chapterPerThousandWords * chapterCount) + (CREDIT_COSTS.image * imageCount);
    }
    const config = AUDIENCE_CONFIG[targetAudience as TargetAudience];
    if (!config) return 0;
    const chapterCredits = Math.ceil((config.wordsPerChapter / 1000) * CREDIT_COSTS.chapterPerThousandWords) * chapterCount;
    const imageCredits   = config.illustrationStyle !== 'none' ? CREDIT_COSTS.image * (chapterCount + 1) : 0;
    return chapterCredits + CREDIT_COSTS.outlineGeneration + imageCredits;
  };

  const estimatedCredits = estimateCredits();
  const hasEnoughCredits = profile ? profile.credits >= estimatedCredits : false;

  const handleFriendName = (index: number, value: string) => {
    setFriendNames(prev => { const next = [...prev]; next[index] = value; return next; });
  };

  const handleGenerationComplete = () => {
    setIsGenerating(false);
    setActiveJobId(null);
    setActiveGenerationJobId(null);
    toast({ title: 'Generation complete!', description: 'Your book has been generated.' });
    setCurrentView('book-detail');
  };

  const handleGenerationError = (error: string) => {
    setIsGenerating(false);
    setActiveJobId(null);
    setActiveGenerationJobId(null);
    toast({ title: 'Generation failed', description: error, variant: 'destructive' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !genre || !targetAudience) {
      toast({ title: 'Missing fields', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    if (genre === 'coloring' && !coloringTheme) {
      toast({ title: 'Theme required', description: 'Please select a coloring theme.', variant: 'destructive' });
      return;
    }
    if (showKidsPersonalization && !adventureType) {
      toast({ title: 'Adventure required', description: 'Please choose an adventure setting for your kids book.', variant: 'destructive' });
      return;
    }

    // Build character names array — index 0 is always the hero, so friends
    // can't be sent without a hero name (Friend 1 would silently become the lead).
    const trimmedFriends = friendNames.map(n => n.trim()).filter(Boolean);
    if (showKidsPersonalization && trimmedFriends.length > 0 && !heroName.trim()) {
      toast({ title: 'Main character needed', description: "Please enter the main character's name before adding friends.", variant: 'destructive' });
      return;
    }
    const characterNames = showKidsPersonalization && heroName.trim()
      ? [heroName.trim(), ...trimmedFriends]
      : [];

    setIsCreating(true);
    try {
      const result = await createBook({
        title: title.trim(),
        description: description.trim() || undefined,
        genre,
        targetAudience,
        coloringTheme: genre === 'coloring' && coloringTheme ? coloringTheme : undefined,
        styleProfileId: styleProfileId || undefined,
        chapterCount: chapterCount || undefined,
        adventureType: showKidsPersonalization && adventureType ? adventureType : undefined,
        characterNames: characterNames.length > 0 ? characterNames : undefined,
      });

      if (!result.success || !result.data) {
        toast({ title: 'Failed to create book', description: result.error || 'Unknown error.', variant: 'destructive' });
        setIsCreating(false);
        return;
      }

      const bookData = result.data as { id: string };
      toast({ title: 'Book created!', description: 'Starting generation...' });
      setSelectedBookId(bookData.id);
      setIsGenerating(true);
      setGenerationGenre(genre);

      try {
        const genResult = await startGeneration(bookData.id);
        if (genResult.success && genResult.data) {
          const data = genResult.data as { jobId: string; estimatedCredits: number };
          setActiveJobId(data.jobId);
          setActiveGenerationJobId(data.jobId);
          toast({ title: 'Generation started!', description: `Estimated ${data.estimatedCredits} credits` });
        } else {
          setIsGenerating(false);
          toast({ title: 'Failed to start generation', description: genResult.error || 'Try clicking Generate on the book detail page.', variant: 'destructive' });
          setCurrentView('book-detail');
        }
      } catch {
        setIsGenerating(false);
        toast({ title: 'Book created but generation failed to start.', description: 'Try clicking Generate on the book detail page.', variant: 'destructive' });
        setCurrentView('book-detail');
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create book. Please try again.', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => setCurrentView('dashboard')} className="text-gray-400 hover:text-white hover:bg-[#1e1e1e]">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold text-white">Create New Book</h1>
          <p className="text-sm text-gray-500">Set up your AI-generated book</p>
        </div>
      </div>

      {activeGenerationJobId ? (
        <div className="space-y-6">
          <Card className="bg-[#2a2a2a] border-purple-500/30">
            <CardContent className="p-6">
              <div className="text-center mb-4">
                <h2 className="text-lg font-bold text-white">{title.trim()}</h2>
                <p className="text-sm text-gray-400 mt-1">Your book is being generated...</p>
              </div>
              <GenerationProgress
                jobId={activeGenerationJobId}
                genre={generationGenre}
                onComplete={handleGenerationComplete}
                onError={handleGenerationError}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
      <form onSubmit={handleSubmit} className="space-y-6">

        {/* ── Book Details ── */}
        <Card className="bg-[#2a2a2a] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-base flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-purple-400" />
              Book Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-gray-300">Title *</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter your book title..."
                className="bg-[#1e1e1e] border-gray-700 text-white placeholder:text-gray-600 focus:border-purple-500"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-gray-300">
                What should the book be about? <span className="text-gray-600 text-xs">(optional)</span>
              </Label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your book idea... (e.g., 'A noir detective story set in 1940s New York with a supernatural twist' or 'A children's book about a brave mouse who explores space')"
                rows={3}
                className="bg-[#1e1e1e] border-gray-700 text-white placeholder:text-gray-600 focus:border-purple-500 w-full px-3 py-2 rounded-md resize-none"
              />
              <p className="text-xs text-gray-500">Help the AI understand your vision. The more detail, the better the result.</p>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Genre *</Label>
              <Select value={genre} onValueChange={handleGenreChange}>
                <SelectTrigger className="bg-[#1e1e1e] border-gray-700 text-white w-full">
                  <SelectValue placeholder="Select a genre" />
                </SelectTrigger>
                <SelectContent className="bg-[#1a1a1a] border-gray-700">
                  {GENRES.map((g) => (
                    <SelectItem key={g.value} value={g.value} className="text-gray-300 focus:bg-[#252525] focus:text-white">
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Coloring Book Theme */}
            {genre === 'coloring' && (
              <div className="space-y-2">
                <Label className="text-gray-300">Coloring Theme *</Label>
                <Select value={coloringTheme} onValueChange={setColoringTheme}>
                  <SelectTrigger className="bg-[#1e1e1e] border-gray-700 text-white w-full">
                    <SelectValue placeholder="Choose a theme..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a1a] border-gray-700 max-h-80">
                    {Object.entries(COLORING_THEMES).map(([key, theme]) => (
                      <SelectItem key={key} value={key} className="text-gray-300 focus:bg-[#252525] focus:text-white">
                        <span className="flex items-center gap-2">
                          <span>{theme.icon}</span>
                          <span>{theme.label}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {coloringTheme && COLORING_THEMES[coloringTheme as ColoringTheme] && (
                  <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
                    <p className="text-xs text-gray-400">{COLORING_THEMES[coloringTheme as ColoringTheme].description}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Target Audience ── */}
        <Card className="bg-[#2a2a2a] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-base">Target Audience *</CardTitle>
          </CardHeader>
          <CardContent>
            <RadioGroup value={targetAudience} onValueChange={setTargetAudience} className="space-y-3">
              {AUDIENCES.map((audience) => (
                <label
                  key={audience.value}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    targetAudience === audience.value
                      ? 'border-purple-500/50 bg-purple-500/5'
                      : 'border-gray-700 bg-[#1e1e1e] hover:border-gray-600'
                  }`}
                >
                  <RadioGroupItem value={audience.value} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-white">{audience.label}</p>
                    <p className="text-xs text-gray-500">{audience.description}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {/* ── Kids Book Personalisation ── only for kids audiences */}
        {showKidsPersonalization && (
          <Card className="bg-[#2a2a2a] border-purple-500/20">
            <CardHeader>
              <CardTitle className="text-white text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-purple-400" />
                Personalise the Story
                <Badge className="bg-purple-500/20 text-purple-300 border-0 text-[10px]">Kids Book</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Adventure Type */}
              <div className="space-y-2">
                <Label className="text-gray-300 flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-cyan-400" />
                  Adventure Setting *
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {KIDS_ADVENTURES.map((adv) => (
                    <button
                      key={adv.value}
                      type="button"
                      onClick={() => setAdventureType(adv.value)}
                      className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm text-left transition-all ${
                        adventureType === adv.value
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-white'
                          : 'border-gray-700 bg-[#1e1e1e] text-gray-400 hover:border-gray-600 hover:text-gray-300'
                      }`}
                    >
                      <span className="text-base">{adv.emoji}</span>
                      <span>{adv.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Hero Name */}
              <div className="space-y-2">
                <Label htmlFor="heroName" className="text-gray-300">
                  Main Character&apos;s Name <span className="text-gray-600 text-xs">(optional — use your child&apos;s name!)</span>
                </Label>
                <Input
                  id="heroName"
                  value={heroName}
                  onChange={(e) => setHeroName(e.target.value)}
                  placeholder="e.g. Lily, Max, Zara..."
                  className="bg-[#1e1e1e] border-gray-700 text-white placeholder:text-gray-600 focus:border-purple-500"
                />
              </div>

              {/* Friend Names */}
              <div className="space-y-2">
                <Label className="text-gray-300">
                  Friend Names <span className="text-gray-600 text-xs">(optional — add up to 4)</span>
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  {friendNames.map((name, i) => (
                    <Input
                      key={i}
                      value={name}
                      onChange={(e) => handleFriendName(i, e.target.value)}
                      placeholder={`Friend ${i + 1}...`}
                      className="bg-[#1e1e1e] border-gray-700 text-white placeholder:text-gray-600 focus:border-purple-500"
                    />
                  ))}
                </div>
                <p className="text-[10px] text-gray-600">
                  These names will be woven into the story as the characters the hero meets on their adventure.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Style Profile (optional) ── */}
        <Card className="bg-[#2a2a2a] border-gray-800">
          <CardHeader>
            <CardTitle className="text-white text-base">
              Style Profile
              <span className="text-xs text-gray-500 font-normal ml-2">— Write like your favourite author</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select value={styleProfileId} onValueChange={(val) => setStyleProfileId(val === '_none' ? '' : val)}>
              <SelectTrigger className="bg-[#1e1e1e] border-gray-700 text-white w-full">
                <SelectValue placeholder="No style profile (default style)" />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-gray-700">
                <SelectItem value="_none" className="text-gray-300 focus:bg-[#252525] focus:text-white">
                  None (default style)
                </SelectItem>
                {styleProfiles.map((sp) => (
                  <SelectItem key={sp.id} value={sp.id} className="text-gray-300 focus:bg-[#252525] focus:text-white">
                    {sp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {styleProfiles.length === 0 && (
              <p className="text-xs text-gray-600">
                No style profiles yet.{' '}
                <button type="button" onClick={() => setCurrentView('style-training')} className="text-purple-400 hover:text-purple-300">
                  Create one →
                </button>
              </p>
            )}

            {/* Chapter count — hidden for kids books (auto-set) */}
            {!isKids && (
              <div className="space-y-2">
                <Label htmlFor="chapters" className="text-gray-300">Chapter Count</Label>
                <Input
                  id="chapters"
                  type="number"
                  min={1}
                  max={50}
                  value={chapterCount || ''}
                  onChange={(e) => { hasManuallySetChapters.current = true; setChapterCount(parseInt(e.target.value) || 0); }}
                  placeholder="Auto-filled from audience"
                  className="bg-[#1e1e1e] border-gray-700 text-white placeholder:text-gray-600 focus:border-purple-500"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Credit Estimate & Submit ── */}
        <Card className="bg-[#2a2a2a] border-gray-800">
          <CardContent className="pt-6 space-y-4">
            {estimatedCredits > 0 && (
              <div className="flex items-center justify-between p-3 rounded-lg bg-[#1e1e1e] border border-gray-700">
                <div>
                  <p className="text-xs text-gray-400">Estimated Credits</p>
                  <p className={`text-lg font-bold ${hasEnoughCredits ? 'text-white' : 'text-red-400'}`}>{estimatedCredits}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Your Balance</p>
                  <p className="text-lg font-bold text-white">{profile?.credits || 0}</p>
                </div>
              </div>
            )}

            {!hasEnoughCredits && estimatedCredits > 0 && (
              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                <p className="text-xs text-red-300">
                  You need {estimatedCredits - (profile?.credits || 0)} more credits.
                </p>
                <Button variant="ghost" size="sm" onClick={() => setCurrentView('credits')} className="text-red-300 hover:text-red-200 mt-1 p-0 h-auto">
                  Purchase credits →
                </Button>
              </div>
            )}

            {genre === 'coloring' && !coloringTheme && (
              <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
                <p className="text-xs text-amber-300">Please select a coloring theme above to continue.</p>
              </div>
            )}

            {showKidsPersonalization && !adventureType && (
              <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-3">
                <p className="text-xs text-cyan-300">Please choose an adventure setting above to continue.</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={
                isCreating ||
                !title.trim() ||
                !genre ||
                !targetAudience ||
                (genre === 'coloring' && !coloringTheme) ||
                (showKidsPersonalization && !adventureType)
              }
              className="w-full btn-gradient h-11"
            >
              {isCreating ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Creating & starting generation...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate Book</>
              )}
            </Button>
          </CardContent>
        </Card>
      </form>
      )}
    </div>
  );
}
