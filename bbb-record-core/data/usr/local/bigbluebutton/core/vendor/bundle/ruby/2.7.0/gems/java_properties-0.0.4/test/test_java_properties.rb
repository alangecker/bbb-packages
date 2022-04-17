require File.dirname(__FILE__) + '/test_helper.rb'

class TestJavaProperties < Test::Unit::TestCase

  def setup
    create_test_files
  end
  
  def teardown
    remove_test_files
  end
  
  def test_truth
    assert true
  end
  
  def test_can_load_from_file
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal TestJavaPropertiesData.content1, props.to_s
  end
  
  def test_can_merge_properties_from_two_files
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    props.load(TestJavaPropertiesData.file2)
    assert_equal TestJavaPropertiesData.content2, props.to_s
  end
  
  def test_can_access_property_by_symbol
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'item1', props[:item1]
  end
  
  def test_can_access_property_by_string
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'item1', props['item1']
  end

  def test_can_access_property_key_with_whitespace
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file2)
    assert_equal 'spaces x', props['spaces x']
  end

  def test_can_store_properties_in_file
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    props.load(TestJavaPropertiesData.file2)
    props.store(TestJavaPropertiesData.file3, 'with header')
    assert( File.exist?(TestJavaPropertiesData.file3) )
    assert_equal TestJavaPropertiesData.content3, get_file_as_string(TestJavaPropertiesData.file3)
  end

  def test_append_properties_to_file
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    props.load(TestJavaPropertiesData.file2)
    props.append(TestJavaPropertiesData.file4,'with spacer')
    assert( File.exist?(TestJavaPropertiesData.file4) )
    assert_equal TestJavaPropertiesData.content4, get_file_as_string(TestJavaPropertiesData.file4)
  end

  def test_ignores_hash_comments
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file2)
    assert_no_match( /Comment 1/, props.to_s)
  end

  def test_ignores_bang_comments
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file2)
    assert_no_match( /Comment 2/, props.to_s)
  end

  def test_sets_key_and_value_seperated_by_equal
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'item1', props[:item1]
  end
  
  def test_sets_key_and_value_seperated_by_colon
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'item2', props[:item2]
  end
  
  def test_sets_key_and_value_seperated_by_whitespace
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'item3', props[:item3]
  end

  def test_sets_multiline_values
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal 'line 1 line 2 line 3', props[:item7]
  end
  
  def test_sets_encoded_unicode
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file2)
    assert_equal "contains \352\260\200 unicode", props[:item12]
  end
  
  def test_sets_backslash_escaped_chars
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal "test\n\ttestP test\n\ttest test\n\ttest = test", props[:item10]
  end

  def test_ignores_leading_whitespace
    props = JavaProperties::Properties.load(TestJavaPropertiesData.file1)
    assert_equal props[:item7], props[:item8]
    assert_equal props[:item7], props[:item9]
  end

end
