import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { ArrowLeft, MapPin, DollarSign, Calendar, ExternalLink, User, Tag } from 'lucide-react'
import './JobDetail.css'

function JobDetail() {
  const { issueNumber } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchJobDetail()
  }, [issueNumber])

  const fetchJobDetail = async () => {
    try {
      setLoading(true)
      const response = await fetch(
        `https://api.github.com/repos/rebase-network/who-is-hiring/issues/${issueNumber}`
      )
      if (!response.ok) {
        throw new Error('无法获取职位详情')
      }
      const data = await response.json()
      setJob(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const extractJobInfo = (title) => {
    const locationMatch = title.match(/\[([^\]]+)\]/)
    const salaryMatch = title.match(/(\d+[kK]?\-?\d*[kK]?)\s*(RMB|USD|USDT|SGD)/i)
    
    return {
      location: locationMatch ? locationMatch[1] : '未指定',
      salary: salaryMatch ? salaryMatch[0] : null,
      title: title.replace(/\[([^\]]+)\]/g, '').trim()
    }
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
          <p className="mt-4 text-gray-600">加载职位详情...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-md p-8 max-w-md">
          <div className="text-red-600 text-center">
            <h3 className="text-lg font-semibold mb-2">加载失败</h3>
            <p>{error}</p>
            <button
              onClick={() => navigate('/')}
              className="mt-4 inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回首页
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!job) return null

  const jobInfo = extractJobInfo(job.title)

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-md sticky top-0 z-10 sticky-header-mobile">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-3 md:py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              className="inline-flex items-center text-gray-600 hover:text-gray-900 active:text-gray-700 py-2"
            >
              <ArrowLeft className="mr-1 md:mr-2 h-4 w-4 md:h-5 md:w-5" />
              <span className="text-sm md:text-base">返回列表</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-3 sm:px-6 lg:px-8 py-4 md:py-8 job-detail-mobile">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {/* Job Header */}
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-4 md:px-8 py-4 md:py-6 text-white">
            <h1 className="text-xl md:text-3xl font-bold mb-3 md:mb-4 leading-tight">{jobInfo.title}</h1>
            
            <div className="flex flex-wrap gap-2 md:gap-3">
              {jobInfo.location && (
                <span className="inline-flex items-center px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium bg-white/20 backdrop-blur-sm">
                  <MapPin className="mr-1 md:mr-2 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                  <span className="truncate max-w-[150px]">{jobInfo.location}</span>
                </span>
              )}
              {jobInfo.salary && (
                <span className="inline-flex items-center px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium bg-white/20 backdrop-blur-sm">
                  <DollarSign className="mr-1 md:mr-2 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                  {jobInfo.salary}
                </span>
              )}
              <span className="inline-flex items-center px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs md:text-sm font-medium bg-white/20 backdrop-blur-sm">
                <Calendar className="mr-1 md:mr-2 h-3 w-3 md:h-4 md:w-4 flex-shrink-0" />
                <span className="hidden sm:inline">{formatDate(job.created_at)}</span>
                <span className="sm:hidden">{new Date(job.created_at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</span>
              </span>
            </div>
          </div>

          {/* Job Meta Info */}
          <div className="border-b border-gray-200 px-4 md:px-8 py-3 md:py-4 bg-gray-50">
            <div className="flex flex-wrap gap-3 md:gap-6 text-xs md:text-sm text-gray-600">
              <div className="flex items-center">
                <User className="mr-2 h-4 w-4" />
                <span>发布者：</span>
                <a 
                  href={job.user.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1 text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  {job.user.login}
                </a>
              </div>
              <div className="flex items-center">
                <Tag className="mr-2 h-4 w-4" />
                <span>Issue #{job.number}</span>
              </div>
              {job.labels && job.labels.length > 0 && (
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  {job.labels.map(label => (
                    <span
                      key={label.id}
                      className="px-2 py-1 rounded text-xs"
                      style={{
                        backgroundColor: `#${label.color}20`,
                        color: `#${label.color}`
                      }}
                    >
                      {label.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Job Description */}
          <div className="px-4 md:px-8 py-4 md:py-6">
            <div className="prose prose-indigo max-w-none prose-sm md:prose-base">
              {job.body ? (
                <ReactMarkdown>{job.body}</ReactMarkdown>
              ) : (
                <p className="text-gray-500 italic">暂无职位描述</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-gray-200 px-4 md:px-8 py-4 md:py-6 bg-gray-50 bottom-action-bar md:relative">
            <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
              <div className="text-xs md:text-sm text-gray-600 text-center md:text-left">
                最后更新：{formatDate(job.updated_at)}
              </div>
              <div className="flex flex-col md:flex-row gap-2 md:gap-3">
                <button
                  onClick={() => navigate('/')}
                  className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 text-sm md:text-base"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  返回列表
                </button>
                <a
                  href={job.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-4 py-2 border border-transparent rounded-md text-white bg-indigo-600 hover:bg-indigo-700 text-sm md:text-base"
                >
                  在 GitHub 申请
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Tips */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-800">
            💡 提示：如需申请此职位，请按照职位描述中的联系方式联系招聘方。
          </p>
        </div>
      </main>
    </div>
  )
}

export default JobDetail
