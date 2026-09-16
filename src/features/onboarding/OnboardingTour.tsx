import { useEffect, useState, useCallback } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { Button } from "../../components/ui";

interface TourStep {
  target: string;
  title: string;
  description: string;
  position?: "bottom" | "top" | "right" | "left";
  highlightPadding?: number;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: ".library-sidebar",
    title: "导航栏",
    description: "这里是所有功能的入口：所有笔记、最近编辑、AI 助手、可视化、云同步等。",
    position: "right",
    highlightPadding: 8,
  },
  {
    target: ".note-list-panel",
    title: "笔记列表",
    description: "显示当前文件夹下的所有笔记。点击笔记即可打开编辑，支持搜索和排序。",
    position: "right",
    highlightPadding: 8,
  },
  {
    target: ".editor-workspace",
    title: "编辑区域",
    description: "左侧编辑 Markdown，右侧实时预览。支持代码高亮、流程图、数学公式等。",
    position: "bottom",
    highlightPadding: 6,
  },
  {
    target: ".view-switcher",
    title: "视图切换",
    description: "在编辑、分屏、预览三种模式之间切换。分屏模式可以边写边看效果。",
    position: "bottom",
    highlightPadding: 6,
  },
  {
    target: ".save-state-group",
    title: "保存状态",
    description: "显示当前笔记的保存状态。支持自动保存，也可以手动保存。旁边显示字数统计。",
    position: "bottom",
    highlightPadding: 8,
  },
  {
    target: ".export-button",
    title: "导出功能",
    description: "支持导出为 PDF（矢量可选字）、Word（含流程图）、HTML、Markdown 四种格式。",
    position: "bottom",
    highlightPadding: 6,
  },
  {
    target: ".ai-nav-item",
    title: "AI 助手",
    description: "AI 写作助手，可以帮你润色、总结、翻译。支持 @引用多篇笔记作为上下文。",
    position: "right",
    highlightPadding: 8,
  },
  {
    target: ".viz-nav-item",
    title: "可视化",
    description: "图谱展示笔记之间的连接关系，思维导图基于标题层级生成，流程图渲染 mermaid 图表。",
    position: "right",
    highlightPadding: 8,
  },
];

export function OnboardingTour() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  const updateHighlight = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    const target = document.querySelector(step.target);
    if (target) {
      const rect = target.getBoundingClientRect();
      setHighlightRect(rect);
    } else {
      setHighlightRect(null);
    }
  }, [currentStep]);

  useEffect(() => {
    const completed = localStorage.getItem("memoir-onboarding-completed");
    if (completed) return;

    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 600);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleShowOnboarding = () => {
      localStorage.removeItem("memoir-onboarding-completed");
      setCurrentStep(0);
      setIsVisible(true);
    };
    window.addEventListener("memoir:show-onboarding", handleShowOnboarding);
    return () => window.removeEventListener("memoir:show-onboarding", handleShowOnboarding);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    updateHighlight();

    const handleResize = () => updateHighlight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [currentStep, isVisible, updateHighlight]);

  const handleNext = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  }, [currentStep, isAnimating]);

  const handlePrev = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);

    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep, isAnimating]);

  const handleSkip = useCallback(() => {
    handleComplete();
  }, []);

  const handleComplete = useCallback(() => {
    localStorage.setItem("memoir-onboarding-completed", "true");
    setIsVisible(false);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleSkip();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, currentStep, handleNext, handlePrev, handleSkip]);

  if (!isVisible) return null;

  const step = TOUR_STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;
  const padding = step.highlightPadding ?? 8;
  const progress = ((currentStep + 1) / TOUR_STEPS.length) * 100;

  const tooltipWidth = 380;
  const tooltipMinHeight = 200;
  const gap = 16;

  let tooltipLeft = 0;
  let tooltipTop = 0;
  let arrowPosition: "top" | "bottom" | "left" | "right" | null = null;

  if (highlightRect) {
    switch (step.position) {
      case "bottom":
        tooltipLeft = highlightRect.left + highlightRect.width / 2 - tooltipWidth / 2;
        tooltipTop = highlightRect.bottom + gap;
        arrowPosition = "top";
        break;
      case "top":
        tooltipLeft = highlightRect.left + highlightRect.width / 2 - tooltipWidth / 2;
        tooltipTop = highlightRect.top - tooltipMinHeight - gap;
        arrowPosition = "bottom";
        break;
      case "right":
        tooltipLeft = highlightRect.right + gap;
        tooltipTop = highlightRect.top + highlightRect.height / 2 - tooltipMinHeight / 2;
        arrowPosition = "left";
        break;
      case "left":
        tooltipLeft = highlightRect.left - tooltipWidth - gap;
        tooltipTop = highlightRect.top + highlightRect.height / 2 - tooltipMinHeight / 2;
        arrowPosition = "right";
        break;
    }

    tooltipLeft = Math.max(16, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 16));
    tooltipTop = Math.max(16, Math.min(tooltipTop, window.innerHeight - tooltipMinHeight - 16));
  } else {
    tooltipLeft = (window.innerWidth - tooltipWidth) / 2;
    tooltipTop = (window.innerHeight - tooltipMinHeight) / 2;
  }

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-mask" />

      {highlightRect && (
        <div
          className="onboarding-highlight"
          onClick={handleNext}
          style={{
            top: highlightRect.top - padding,
            left: highlightRect.left - padding,
            width: highlightRect.width + padding * 2,
            height: highlightRect.height + padding * 2,
          }}
        />
      )}

      <div
        className={`onboarding-tooltip onboarding-tooltip--arrow-${arrowPosition || "none"}`}
        style={{
          left: tooltipLeft,
          top: tooltipTop,
          width: tooltipWidth,
        }}
      >
        <div className="onboarding-tooltip__header">
          <div className="onboarding-tooltip__badge">
            <Sparkles className="h-3.5 w-3.5" />
            <span>新手指引</span>
          </div>
          <button className="onboarding-close" onClick={handleSkip} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="onboarding-tooltip__body">
          <div className="onboarding-step-indicator">
            第 {currentStep + 1} 步 / 共 {TOUR_STEPS.length} 步
          </div>
          <h3 className="onboarding-title">{step.title}</h3>
          <p className="onboarding-description">{step.description}</p>
        </div>

        <div className="onboarding-progress">
          <div className="onboarding-progress__track">
            <div
              className="onboarding-progress__fill"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="onboarding-actions">
          <Button variant="ghost" size="sm" onClick={handleSkip} className="onboarding-skip-btn">
            跳过引导
          </Button>
          <div className="onboarding-nav">
            {!isFirst && (
              <Button variant="secondary" size="sm" onClick={handlePrev}>
                <ChevronLeft className="h-4 w-4" />
                上一步
              </Button>
            )}
            <Button size="sm" onClick={handleNext} className="onboarding-next-btn">
              {isLast ? "开始使用" : "下一步"}
              {!isLast && <ChevronRight className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
