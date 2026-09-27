import type {Argv, ArgumentsCamelCase} from 'yargs'

export type BuilderOptions<B> = B extends (yargs: Argv) => Argv<infer T> ? T : never

export type CommandArgv<B, P = {}> = ArgumentsCamelCase<Omit<BuilderOptions<B>, keyof P> & P>
