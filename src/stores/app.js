import { defineStore } from "pinia";

const PRINT_PREVIEW_STORAGE_KEY = 'primary-math-print-preview'

export const useAppStore = defineStore('app', {
  state: () => ({
    printPreviewPapers: []
  }),
  actions: {
    restorePrintPreview() {
      if (this.printPreviewPapers.length || typeof sessionStorage === 'undefined') return
      try {
        const papers = JSON.parse(sessionStorage.getItem(PRINT_PREVIEW_STORAGE_KEY) || '[]')
        if (Array.isArray(papers)) this.printPreviewPapers = papers
      } catch {
        sessionStorage.removeItem(PRINT_PREVIEW_STORAGE_KEY)
      }
    },
    /**
     * @param {import("vue-router").Router} router
     * @param {String} fileName
     * @param {Array} printPreviewPapers
     */
    async navigateToPrint(router, fileName, printPreviewPapers) {
      if (!Array.isArray(printPreviewPapers) || !printPreviewPapers.length) {
        throw new Error('没有可预览的试卷数据')
      }
      this.printPreviewPapers = printPreviewPapers
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(PRINT_PREVIEW_STORAGE_KEY, JSON.stringify(printPreviewPapers))
      }
      await router.push({ path: '/print', query: { fileName } })
    }
  }
})