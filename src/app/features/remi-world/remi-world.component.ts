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
import { AiOrchestratorService } from '../../services/ai-orchestrator.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { TypewriterDirective } from '../../shared/typewriter/typewriter.directive';

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
    LoadingAnimationComponent,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent,
    TypewriterDirective
  ],
  templateUrl: './remi-world.component.html',
  styleUrl: './remi-world.component.scss'
})
export class RemiWorldComponent {
  private aiOrchestrator = inject(AiOrchestratorService);
  
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
    try {
      const data = await this.aiOrchestrator.generate<any>('remi-quiz-question', { category });

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
