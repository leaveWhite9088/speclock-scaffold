/** Tool-call markup a model wrote out as plain text instead of making the call (`<｜DSML｜…`, `<function=…>`, `<parameter=…>`). Nothing runs when this happens. */
export const TOOL_CALL_AS_TEXT = /<｜DSML｜|<\/?function(?:=|_calls)|<parameter=|<\/parameter>|<\|tool_call/;
