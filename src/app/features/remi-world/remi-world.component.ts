import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatChipsModule } from '@angular/material/chips';

interface QuizQuestion {
  id: string;
  type: 'spelling' | 'math' | 'multiple-choice';
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
    MatChipsModule
  ],
  templateUrl: './remi-world.component.html',
  styleUrl: './remi-world.component.scss'
})
export class RemiWorldComponent {
  selectedCategory = signal<string>('');
  currentQuestion = signal<QuizQuestion | null>(null);
  userAnswer = signal<string>('');
  quizResults = signal<QuizResult[]>([]);
  showResult = signal<boolean>(false);
  currentResult = signal<boolean | null>(null);

  // Quiz questions by category
  private quizQuestions: Record<string, QuizQuestion[]> = {
    spelling: [
      {
        id: 's1',
        type: 'spelling',
        question: 'Spell the word: ELEPHANT',
        correctAnswer: 'elephant',
        hint: 'A large animal with a trunk'
      },
      {
        id: 's2',
        type: 'spelling',
        question: 'Spell the word: BEAUTIFUL',
        correctAnswer: 'beautiful',
        hint: 'Something that looks very nice'
      },
      {
        id: 's3',
        type: 'spelling',
        question: 'Spell the word: FRIENDSHIP',
        correctAnswer: 'friendship',
        hint: 'The relationship between friends'
      },
      {
        id: 's4',
        type: 'spelling',
        question: 'Spell the word: BUTTERFLY',
        correctAnswer: 'butterfly',
        hint: 'A flying insect with colorful wings'
      },
      {
        id: 's5',
        type: 'spelling',
        question: 'Spell the word: RAINBOW',
        correctAnswer: 'rainbow',
        hint: 'Appears in the sky after rain'
      }
    ],
    math: [
      {
        id: 'm1',
        type: 'math',
        question: 'What is 5 + 7?',
        correctAnswer: '12'
      },
      {
        id: 'm2',
        type: 'math',
        question: 'What is 15 - 8?',
        correctAnswer: '7'
      },
      {
        id: 'm3',
        type: 'math',
        question: 'What is 6 × 4?',
        correctAnswer: '24'
      },
      {
        id: 'm4',
        type: 'math',
        question: 'What is 20 ÷ 5?',
        correctAnswer: '4'
      },
      {
        id: 'm5',
        type: 'math',
        question: 'What is 9 + 6?',
        correctAnswer: '15'
      },
      {
        id: 'm6',
        type: 'math',
        question: 'What is 12 × 3?',
        correctAnswer: '36'
      }
    ],
    trivia: [
      {
        id: 't1',
        type: 'multiple-choice',
        question: 'What color is the sky on a clear day?',
        correctAnswer: 'Blue',
        options: ['Red', 'Blue', 'Green', 'Yellow']
      },
      {
        id: 't2',
        type: 'multiple-choice',
        question: 'How many legs does a spider have?',
        correctAnswer: '8',
        options: ['6', '8', '10', '4']
      },
      {
        id: 't3',
        type: 'multiple-choice',
        question: 'What is the capital of the United States?',
        correctAnswer: 'Washington, D.C.',
        options: ['New York', 'Los Angeles', 'Washington, D.C.', 'Chicago']
      },
      {
        id: 't4',
        type: 'multiple-choice',
        question: 'Which planet is known as the Red Planet?',
        correctAnswer: 'Mars',
        options: ['Venus', 'Mars', 'Jupiter', 'Saturn']
      },
      {
        id: 't5',
        type: 'multiple-choice',
        question: 'How many days are in a leap year?',
        correctAnswer: '366',
        options: ['365', '366', '364', '367']
      }
    ]
  };

  selectCategory(category: string): void {
    this.selectedCategory.set(category);
    this.quizResults.set([]);
    this.loadNextQuestion();
  }

  loadNextQuestion(): void {
    const category = this.selectedCategory();
    const questions = this.quizQuestions[category];
    const answeredIds = this.quizResults().map(r => r.questionId);
    const unansweredQuestions = questions.filter(q => !answeredIds.includes(q.id));

    if (unansweredQuestions.length > 0) {
      const randomIndex = Math.floor(Math.random() * unansweredQuestions.length);
      this.currentQuestion.set(unansweredQuestions[randomIndex]);
      this.userAnswer.set('');
      this.showResult.set(false);
      this.currentResult.set(null);
    } else {
      this.currentQuestion.set(null);
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

  isQuizComplete(): boolean {
    const category = this.selectedCategory();
    if (!category) return false;
    const totalQuestions = this.quizQuestions[category].length;
    return this.quizResults().length >= totalQuestions;
  }
}
