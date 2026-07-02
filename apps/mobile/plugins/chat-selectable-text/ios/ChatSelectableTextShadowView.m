#import "ChatSelectableTextShadowView.h"

#import <math.h>
#import <yoga/Yoga.h>

@interface ChatSelectableTextShadowView ()
- (CGSize)measureTextWithWidth:(CGFloat)width widthMode:(YGMeasureMode)widthMode;
@end

static YGSize ChatSelectableTextShadowMeasure(
    YGNodeConstRef node,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode);

@implementation ChatSelectableTextShadowView

- (instancetype)init
{
  if ((self = [super init])) {
    _text = @"";
    _blankRangesJson = @"[]";
    _answersVisible = NO;
    _fontSize = @17;
    _lineHeight = @25;
    _fontWeight = @"";
    YGNodeSetMeasureFunc(self.yogaNode, ChatSelectableTextShadowMeasure);
  }
  return self;
}

static YGSize ChatSelectableTextShadowMeasure(
    YGNodeConstRef node,
    float width,
    YGMeasureMode widthMode,
    float height,
    YGMeasureMode heightMode)
{
  ChatSelectableTextShadowView *shadowView = (__bridge ChatSelectableTextShadowView *)YGNodeGetContext(node);
  CGSize measured = [shadowView measureTextWithWidth:width widthMode:widthMode];

  if (heightMode == YGMeasureModeExactly) {
    measured.height = height;
  } else if (heightMode == YGMeasureModeAtMost) {
    measured.height = MIN(measured.height, height);
  }

  return (YGSize){(float)measured.width, (float)measured.height};
}

- (BOOL)isYogaLeafNode
{
  return YES;
}

- (void)setText:(NSString *)text
{
  _text = text ?: @"";
  YGNodeMarkDirty(self.yogaNode);
}

- (void)setBlankRangesJson:(NSString *)blankRangesJson
{
  _blankRangesJson = blankRangesJson ?: @"[]";
  YGNodeMarkDirty(self.yogaNode);
}

- (void)setAnswersVisible:(BOOL)answersVisible
{
  _answersVisible = answersVisible;
  YGNodeMarkDirty(self.yogaNode);
}

- (void)setFontSize:(NSNumber *)fontSize
{
  _fontSize = fontSize ?: @17;
  YGNodeMarkDirty(self.yogaNode);
}

- (void)setLineHeight:(NSNumber *)lineHeight
{
  _lineHeight = lineHeight ?: @25;
  YGNodeMarkDirty(self.yogaNode);
}

- (void)setFontWeight:(NSString *)fontWeight
{
  _fontWeight = fontWeight ?: @"";
  YGNodeMarkDirty(self.yogaNode);
}

- (CGSize)measureTextWithWidth:(CGFloat)width widthMode:(YGMeasureMode)widthMode
{
  CGFloat fontSize = self.fontSize.floatValue > 0 ? self.fontSize.floatValue : 17.0;
  CGFloat lineHeight = self.lineHeight.floatValue > 0 ? self.lineHeight.floatValue : 25.0;
  NSString *visibleText = [self visibleTextForText:self.text blankRanges:[self parseRanges:self.blankRangesJson] answersVisible:self.answersVisible];
  if (visibleText.length == 0) {
    return CGSizeMake(widthMode == YGMeasureModeUndefined ? 0 : width, lineHeight);
  }

  NSMutableAttributedString *attributed = [[NSMutableAttributedString alloc] initWithString:visibleText];
  NSRange fullRange = NSMakeRange(0, attributed.length);
  UIFont *font = [self fontForSize:fontSize weight:self.fontWeight];
  NSMutableParagraphStyle *paragraph = [NSMutableParagraphStyle new];
  paragraph.minimumLineHeight = lineHeight;
  paragraph.maximumLineHeight = lineHeight;
  [attributed addAttributes:@{
    NSFontAttributeName: font,
    NSParagraphStyleAttributeName: paragraph
  } range:fullRange];

  UIFont *boldFont = [UIFont boldSystemFontOfSize:fontSize];
  for (NSDictionary *range in [self parseRanges:self.blankRangesJson]) {
    NSRange safe = [self safeRangeFromDictionary:range length:attributed.length];
    if (safe.length == 0) continue;
    [attributed addAttribute:NSFontAttributeName value:boldFont range:safe];
  }

  CGFloat measuringWidth = widthMode == YGMeasureModeUndefined || width <= 0 ? CGFLOAT_MAX : width;
  NSTextStorage *storage = [[NSTextStorage alloc] initWithAttributedString:attributed];
  NSLayoutManager *layoutManager = [NSLayoutManager new];
  NSTextContainer *container = [[NSTextContainer alloc] initWithSize:CGSizeMake(measuringWidth, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  container.maximumNumberOfLines = 0;
  [layoutManager addTextContainer:container];
  [storage addLayoutManager:layoutManager];
  [layoutManager glyphRangeForTextContainer:container];
  CGRect usedRect = [layoutManager usedRectForTextContainer:container];

  CGFloat measuredWidth = widthMode == YGMeasureModeUndefined ? ceil(usedRect.size.width) : width;
  CGFloat measuredHeight = ceil(MAX(usedRect.size.height, lineHeight)) + 4.0;
  return CGSizeMake(measuredWidth, measuredHeight);
}

- (UIFont *)fontForSize:(CGFloat)size weight:(NSString *)weight
{
  if ([weight isEqualToString:@"bold"] || [weight isEqualToString:@"700"] || [weight isEqualToString:@"800"] || [weight isEqualToString:@"900"]) {
    return [UIFont boldSystemFontOfSize:size];
  }
  return [UIFont systemFontOfSize:size];
}

- (NSArray<NSDictionary *> *)parseRanges:(NSString *)json
{
  NSData *data = [(json ?: @"[]") dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return @[];
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![value isKindOfClass:NSArray.class]) return @[];
  NSMutableArray<NSDictionary *> *ranges = [NSMutableArray new];
  NSInteger index = 0;
  for (id item in (NSArray *)value) {
    if (![item isKindOfClass:NSDictionary.class]) continue;
    NSInteger start = [item[@"start"] integerValue];
    NSInteger end = [item[@"end"] integerValue];
    NSInteger groupIndex = item[@"groupIndex"] ? [item[@"groupIndex"] integerValue] : index;
    if (start < end) {
      [ranges addObject:@{ @"start": @(start), @"end": @(end), @"groupIndex": @(groupIndex) }];
    }
    index += 1;
  }
  return ranges;
}

- (NSRange)safeRangeFromDictionary:(NSDictionary *)range length:(NSUInteger)length
{
  NSUInteger start = MIN((NSUInteger)MAX(0, [range[@"start"] integerValue]), length);
  NSUInteger end = MIN((NSUInteger)MAX((NSInteger)start, [range[@"end"] integerValue]), length);
  return NSMakeRange(start, end - start);
}

- (NSString *)visibleTextForText:(NSString *)text blankRanges:(NSArray<NSDictionary *> *)blankRanges answersVisible:(BOOL)answersVisible
{
  if (answersVisible || blankRanges.count == 0) return text ?: @"";
  NSMutableString *mutable = [(text ?: @"") mutableCopy];
  for (NSDictionary *range in blankRanges) {
    NSRange safe = [self safeRangeFromDictionary:range length:mutable.length];
    for (NSUInteger index = safe.location; index < NSMaxRange(safe); index += 1) {
      unichar ch = [mutable characterAtIndex:index];
      if (![[NSCharacterSet whitespaceAndNewlineCharacterSet] characterIsMember:ch]) {
        [mutable replaceCharactersInRange:NSMakeRange(index, 1) withString:@"_"];
      }
    }
  }
  return mutable;
}

@end
