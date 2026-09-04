import FormulasGenerator from "./psm.js";

/**
 * 生成试卷
 * @param {Object} options 生成试卷的配置参数
 * @param {Array} paperList 需要生成的题型组
 * @returns
 */
export function createFormulasGenerator(options, paperList) {
  const seed = options.seed || `${Date.now()}-${Math.random()}`;
  // 组装需要自动生成的题型组
  const postAutoGeneratePaperList = paperList.filter(p => !p.customFormulaList).map(p => {

    const multiSteps = p.formulaList.map(j => [parseInt(j.min), parseInt(j.max)])
    const symbols = p.formulaList.reduce((pre, cur) => {
      cur.operators && pre.push(cur.operators)
      return pre
    }, [])

    // 补缺
    for (let i = 0; i < 4 - p.formulaList.length; i++) {
      multiSteps.push([1, 9])
      symbols.push([1])
    }

    multiSteps.push([p.resultMinValue, p.resultMaxValue])

    return {
      step: parseInt(p.step),
      number: parseInt(p.numberOfFormulas),
      is_result: parseInt(p.whereIsResult),
      is_bracket: options.enableBrackets ? 1 : 0,
      add: { carry: parseInt(options.carry) },
      sub: { abdication: parseInt(options.abdication) },
      mult: {},
      div: { remainder: parseInt(options.remainder) },
      multistep: multiSteps,
      symbols,
    }
  })

  const papers = []

  for (let i = 0; i < parseInt(options.numberOfPapers); i++) {
    const generatedQuestions = postAutoGeneratePaperList.reduce((pre, cur, sectionIndex) => {
      const op = cur
      const Gen = new FormulasGenerator(op.add, op.sub, op.mult, op.div, op.step, op.number, op.is_result, op.is_bracket, op.multistep, op.symbols, {
        seed: `${seed}-paper-${i}-section-${sectionIndex}`,
      })
      pre.push(...Gen.generateQuestions())
      return pre
    }, [])
    // Fisher-Yates 洗牌，避免 sort(Math.random) 造成分布偏差；题目和答案必须一起移动。
    for (let index = generatedQuestions.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1))
      ;[generatedQuestions[index], generatedQuestions[swapIndex]] = [generatedQuestions[swapIndex], generatedQuestions[index]]
    }
    const f = generatedQuestions.map(question => question.display)

    papers.push({
      paperTitle: options.paperTitle || '小学生口算题',
      paperSubTitle: options.paperSubTitle || '姓名：__________ 日期：____月____日 时间：________',
      numberOfPagerColumns: parseInt(options.numberOfPagerColumns),
      solution: options.solution,
      formulas: f,
      // MVP 先保留现有打印字符串，同时暴露结构化题目供判题/错题分析使用。
      questions: generatedQuestions.map((question, index) => ({ ...question, id: `q-${index + 1}` })),
    })
  }

  console.log('papers', papers);
  return papers
}