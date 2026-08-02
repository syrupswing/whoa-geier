import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GithubAiService } from '../../services/github-ai.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

interface QuizQuestion {
  id: string;
  type: 'spelling' | 'math' | 'fun-facts';
  question: string;
  correctAnswer: string;
  options?: string[]; // For multiple choice
  hint?: string;
}

interface QuizResult {
  questionId: string;
  correct: boolean;
  userAnswer: string;
}

@Component({
  selector: 'app-remi-world',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    GlobalNavMenuComponent
  ],
  templateUrl: './remi-world.component.html',
  styleUrl: './remi-world.component.scss'
})
export class RemiWorldComponent {
  private aiService = inject(GithubAiService);
  
  selectedCategory = signal<string>('');
  currentQuestion = signal<QuizQuestion | null>(null);
  userAnswer = signal<string>('');
  quizResults = signal<QuizResult[]>([]);
  showResult = signal<boolean>(false);
  currentResult = signal<boolean | null>(null);
  isLoading = signal<boolean>(false);

  async selectCategory(category: string): Promise<void> {
    this.selectedCategory.set(category);
    this.quizResults.set([]);
    await this.loadNextQuestion();
  }

  async loadNextQuestion(): Promise<void> {
    this.isLoading.set(true);
    try {
      const category = this.selectedCategory();
      const question = await this.generateQuestion(category);
      
      if (question) {
        this.currentQuestion.set(question);
        this.userAnswer.set('');
        this.showResult.set(false);
        this.currentResult.set(null);
      }
    } catch (error) {
      console.error('Error loading question:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  private async generateQuestion(category: string): Promise<QuizQuestion | null> {
    let prompt = '';
    let questionType: QuizQuestion['type'] = 'math';

    switch (category) {
      case 'spelling':
        questionType = 'spelling';
        prompt = `Generate 1 unique and creative spelling question for a 5-6 year old child. Use variety in word selection across these categories:

EASY WORDS (3-4 letters): cat, dog, sun, run, hat, mat, box, fox, bat, rat, bug, hug, jet, net, pen, hen, top, mop, car, jar
MEDIUM WORDS (4-6 letters): happy, silly, funny, apple, pizza, tiger, ninja, magic, dragon, robot, wizard, castle, banana, cookie, rocket, turtle, monkey, pencil
MINECRAFT THEMED: mine, cave, dirt, wood, tree, gold, iron, crop, farm, food, chest, sword, block, stone, craft
NATURE WORDS: bird, fish, frog, leaf, seed, moon, star, rain, snow, wind
ACTION WORDS: swim, jump, run, hop, skip, play, read, sing, dance, climb

Pick ONE word randomly from ANY category above (mix it up!). Create an engaging sentence that relates to Minecraft, nature, or something fun. Return ONLY a JSON object in this format:
{
  "word": "dragon",
  "sentence": "Can you spell DRAGON? In Minecraft, the ender dragon flies in the sky!",
  "hint": "A big flying creature that breathes fire"
}`;
        break;
      
      case 'math':
        questionType = 'math';
        prompt = `Generate 1 simple math question for a 5-6 year old child. Use addition or subtraction with numbers 1-10 only. Make it fun and engaging. Return ONLY a JSON object in this format:
{
  "question": "If you have 3 blocks and get 2 more, how many blocks do you have?",
  "answer": "5"
}`;
        break;
      
      case 'fun-facts':
        questionType = 'fun-facts';
        prompt = `Generate 1 fun multiple choice question for a 5-6 year old child about Minecraft or animals or nature. Make it fun and educational. Return ONLY a JSON object in this format:
{
  "question": "What do creepers in Minecraft do?",
  "correctAnswer": "Explode",
  "options": ["Explode", "Fly", "Swim", "Sleep"]
}`;
        break;
    }

    try {
      const response = await this.aiService.generateContent(prompt);
      
      if (!response.success || !response.text) {
        throw new Error(response.error || 'Failed to generate question');
      }

      // Parse the AI response
      let jsonText = response.text.trim();
      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const data = JSON.parse(jsonText);
      
      // Build question based on category
      if (category === 'spelling') {
        return {
          id: Date.now().toString(),
          type: 'spelling',
          question: data.sentence || `Spell the word: ${data.word.toUpperCase()}`,
          correctAnswer: data.word.toLowerCase(),
          hint: data.hint
        };
      } else if (category === 'math') {
        return {
          id: Date.now().toString(),
          type: 'math',
          question: data.question,
          correctAnswer: data.answer.toString().toLowerCase()
        };
      } else { // fun-facts
        return {
          id: Date.now().toString(),
          type: 'fun-facts',
          question: data.question,
          correctAnswer: data.correctAnswer,
          options: data.options
        };
      }
    } catch (error) {
      console.error('Error parsing AI response:', error);
      return null;
    }
  }

  submitAnswer(): void {
    const question = this.currentQuestion();
    if (!question) return;

    const userAns = this.userAnswer().trim().toLowerCase();
    const correctAns = question.correctAnswer.toLowerCase();
    const isCorrect = userAns === correctAns;

    this.currentResult.set(isCorrect);
    this.showResult.set(true);

    const result: QuizResult = {
      questionId: question.id,
      correct: isCorrect,
      userAnswer: this.userAnswer()
    };

    this.quizResults.set([...this.quizResults(), result]);
  }

  nextQuestion(): void {
    this.loadNextQuestion();
  }

  restartQuiz(): void {
    this.quizResults.set([]);
    this.loadNextQuestion();
  }

  backToCategories(): void {
    this.selectedCategory.set('');
    this.currentQuestion.set(null);
    this.quizResults.set([]);
    this.showResult.set(false);
  }

  getScore(): { correct: number; total: number } {
    const results = this.quizResults();
    return {
      correct: results.filter(r => r.correct).length,
      total: results.length
    };
  }

  getScorePercentage(): number {
    const score = this.getScore();
    if (score.total === 0) return 0;
    return Math.round((score.correct / score.total) * 100);
  }
}
