'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, CheckCircle, ArrowRight } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { stripAdventureToken } from '@/lib/utils/kidsBook';

interface OutlineChapter {
  title: string;
  synopsis: string;
  wordTarget: number;
}

interface OutlineEditorProps {
  outline: OutlineChapter[];
  onApprove: (updatedOutline: OutlineChapter[]) => Promise<void>;
  isLoading: boolean;
}

export default function OutlineEditor({ outline, onApprove, isLoading }: OutlineEditorProps) {
  // Scrub the kids-book sentinel token from older outlines so the user never
  // sees "AdventureSettingToken: FARM -" in the editor.
  const [editedOutline, setEditedOutline] = useState<OutlineChapter[]>(() =>
    outline.map((ch) => ({
      ...ch,
      title: stripAdventureToken(ch.title) || ch.title,
      synopsis: stripAdventureToken(ch.synopsis),
    }))
  );

  const handleUpdateChapter = (index: number, field: keyof OutlineChapter, value: string) => {
    const next = [...editedOutline];
    next[index] = { ...next[index], [field]: value };
    setEditedOutline(next);
  };

  return (
    <Card className="bg-[#2a2a2a] border-purple-500/30">
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-400" />
          Story Blueprint
        </CardTitle>
        <p className="text-sm text-gray-400">
          Review and refine your story blueprint before the AI starts writing.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          {editedOutline.map((ch, i) => (
            <div key={i} className="p-4 rounded-xl bg-[#1e1e1e] border border-gray-800 space-y-3">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-purple-400 border-purple-500/30">
                  Chapter {i + 1}
                </Badge>
                <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">
                  {ch.wordTarget} words
                </span>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Chapter Title</Label>
                <Input
                  value={ch.title}
                  onChange={(e) => handleUpdateChapter(i, 'title', e.target.value)}
                  className="bg-[#121214] border-gray-700 text-white h-9"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-gray-500">Plot Point / Synopsis</Label>
                <Input
                  value={ch.synopsis}
                  onChange={(e) => handleUpdateChapter(i, 'synopsis', e.target.value)}
                  className="bg-[#121214] border-gray-700 text-white h-12"
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          onClick={() => onApprove(editedOutline)}
          disabled={isLoading}
          className="w-full btn-gradient h-12 text-lg"
        >
          {isLoading ? 'Processing...' : (
            <>
              <CheckCircle className="h-5 w-5 mr-2" />
              Approve Blueprint & Start Writing
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
