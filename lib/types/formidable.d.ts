import 'formidable'

declare module 'formidable' {
  interface File {
    submissionSequence?: number
    isAab?: boolean
  }
}
